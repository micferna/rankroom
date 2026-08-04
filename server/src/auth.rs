use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{db::User, error::ApiError, AppState};

pub const SESSION_COOKIE: &str = "rankroom_session";
/// The handshake is a round trip through Twitch; ten minutes is generous.
const OAUTH_STATE_TTL_MINUTES: i64 = 10;

/// 256 bits from the OS generator, URL-safe.
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Tokens are stored hashed, never in the clear.
///
/// A database leak then yields no usable session: an attacker would have to
/// reverse SHA-256 to get a token the server would accept. The tokens are
/// full-entropy random, so there is nothing to guess and no salt to add.
fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub struct IssuedSession {
    pub token: String,
    pub expires_at: OffsetDateTime,
}

pub async fn create_session(
    pool: &PgPool,
    user_id: Uuid,
    ttl: std::time::Duration,
    user_agent: Option<&str>,
) -> sqlx::Result<IssuedSession> {
    let token = random_token();
    let expires_at = OffsetDateTime::now_utc()
        + Duration::seconds(i64::try_from(ttl.as_secs()).unwrap_or(i64::MAX));

    sqlx::query(
        "insert into sessions (token_hash, user_id, expires_at, user_agent) values ($1, $2, $3, $4)",
    )
    .bind(hash(&token))
    .bind(user_id)
    .bind(expires_at)
    .bind(user_agent.map(|value| value.chars().take(200).collect::<String>()))
    .execute(pool)
    .await?;

    Ok(IssuedSession { token, expires_at })
}

pub async fn revoke_session(pool: &PgPool, token: &str) -> sqlx::Result<()> {
    sqlx::query("delete from sessions where token_hash = $1")
        .bind(hash(token))
        .execute(pool)
        .await
        .map(|_| ())
}

/// Resolves a session token to its user, refusing anything expired.
pub async fn user_for_token(pool: &PgPool, token: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        r"
        select u.id, u.twitch_id, u.login, u.display_name, u.avatar_url
        from sessions s
        join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now()
        ",
    )
    .bind(hash(token))
    .fetch_optional(pool)
    .await
}

/// Stores a pending OAuth handshake, returning the opaque `state` to send out.
pub async fn begin_oauth(pool: &PgPool, verifier: &str) -> sqlx::Result<String> {
    let state = random_token();

    sqlx::query(
        "insert into oauth_states (state_hash, pkce_verifier, expires_at) values ($1, $2, $3)",
    )
    .bind(hash(&state))
    .bind(verifier)
    .bind(OffsetDateTime::now_utc() + Duration::minutes(OAUTH_STATE_TTL_MINUTES))
    .execute(pool)
    .await?;

    Ok(state)
}

/// Consumes a handshake. Deleting and returning in one statement makes a state
/// single-use even if two callbacks arrive at once.
pub async fn take_oauth(pool: &PgPool, state: &str) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar::<_, String>(
        "delete from oauth_states where state_hash = $1 and expires_at > now() returning pkce_verifier",
    )
    .bind(hash(state))
    .fetch_optional(pool)
    .await
}

/// Removes expired sessions and abandoned handshakes.
pub async fn purge_expired(pool: &PgPool) -> sqlx::Result<u64> {
    let sessions = sqlx::query("delete from sessions where expires_at <= now()")
        .execute(pool)
        .await?
        .rows_affected();

    let states = sqlx::query("delete from oauth_states where expires_at <= now()")
        .execute(pool)
        .await?
        .rows_affected();

    Ok(sessions + states)
}

/// PKCE: a random verifier, and the SHA-256 challenge derived from it.
#[must_use]
pub fn pkce_pair() -> (String, String) {
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

#[must_use]
pub fn cookie(name: &str, value: &str, max_age: i64, secure: bool) -> String {
    let mut cookie = format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    // Lax rather than Strict: the OAuth callback is a cross-site navigation, and
    // Strict would drop the cookie on the very redirect that sets it.
    if secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn cookie_value<'a>(parts: &'a Parts, name: &str) -> Option<&'a str> {
    parts
        .headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

/// A request that carries a valid session. Handlers that take this cannot run
/// without one, which is the point: authentication is a type, not a habit.
pub struct Auth(pub User);

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = cookie_value(parts, SESSION_COOKIE).ok_or(ApiError::Unauthorised)?;

        user_for_token(&state.pool, token)
            .await?
            .map(Auth)
            .ok_or(ApiError::Unauthorised)
    }
}

/// Like [`Auth`] but optional, for endpoints that behave differently when
/// someone is signed in without requiring it.
pub struct MaybeAuth(pub Option<User>);

impl FromRequestParts<AppState> for MaybeAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        match cookie_value(parts, SESSION_COOKIE) {
            None => Ok(Self(None)),
            Some(token) => Ok(Self(user_for_token(&state.pool, token).await?)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_long_enough() {
        let first = random_token();
        let second = random_token();

        assert_ne!(first, second);
        assert!(first.len() >= 43, "expected 256 bits of base64url");
    }

    #[test]
    fn hashing_is_stable_and_collision_free_for_distinct_tokens() {
        assert_eq!(hash("abc"), hash("abc"));
        assert_ne!(hash("abc"), hash("abd"));
        assert_eq!(hash("abc").len(), 32);
    }

    #[test]
    fn pkce_challenge_is_derived_from_the_verifier() {
        let (verifier, challenge) = pkce_pair();
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

        assert_eq!(challenge, expected);
        assert_ne!(challenge, verifier);
    }

    #[test]
    fn cookies_are_locked_down() {
        let secure = cookie("s", "v", 60, true);
        assert!(secure.contains("HttpOnly"));
        assert!(secure.contains("SameSite=Lax"));
        assert!(secure.contains("Secure"));

        // Only local HTTP development drops Secure.
        assert!(!cookie("s", "v", 60, false).contains("Secure"));
    }
}
