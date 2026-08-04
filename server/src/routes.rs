use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{sse::Event, IntoResponse, Redirect, Response, Sse},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::Stream;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::{self, Auth},
    board::{self, BoardSummary, SaveBoard},
    db::{self, BoardRow},
    error::{ApiError, ApiResult},
    overlay, AppState,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/auth/twitch/start", get(twitch_start))
        .route("/api/auth/twitch/callback", get(twitch_callback))
        .route("/api/auth/logout", post(logout))
        .route("/api/me", get(me).delete(delete_me))
        .route("/api/boards", get(list_boards).post(save_board))
        .route("/api/boards/{id}", get(get_board).put(update_board))
        .route("/api/boards/{id}", delete(remove_board))
        .route("/api/overlay/key", post(rotate_overlay_key))
        .route("/api/overlay/live", get(overlay_stream))
        .route("/api/u/{login}", get(public_profile))
        .route("/api/b/{slug}", get(public_board))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    // A health check that does not touch the database is a health check that
    // stays green while the service is useless.
    sqlx::query("select 1").execute(&state.pool).await?;
    Ok(Json(json!({ "status": "ok" })))
}

// --- authentication ---------------------------------------------------------

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn twitch_start(State(state): State<AppState>) -> ApiResult<Response> {
    let twitch = state
        .config
        .twitch
        .as_ref()
        .ok_or(ApiError::SignInUnavailable)?;

    let (verifier, challenge) = auth::pkce_pair();
    let handshake = auth::begin_oauth(&state.pool, &verifier).await?;

    // The half of the handshake that stays in this browser. Ten minutes, so an
    // abandoned sign-in leaves nothing behind.
    let secure = !state.config.insecure_cookies;
    let binding = auth::cookie(
        auth::oauth_cookie_name(secure),
        &handshake.binding,
        60 * 10,
        secure,
    );

    // Only the user's identity is requested: no channel, chat or stream scopes.
    // The chat features run anonymously and need nothing from this token.
    let url = format!(
        "https://id.twitch.tv/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope=&state={}&code_challenge={}&code_challenge_method=S256",
        urlencode(&twitch.client_id),
        urlencode(&state.config.redirect_uri()),
        urlencode(&handshake.state),
        urlencode(&challenge),
    );

    Ok(([(header::SET_COOKIE, binding)], Redirect::to(&url)).into_response())
}

#[derive(Deserialize)]
struct TwitchTokens {
    access_token: String,
}

#[derive(Deserialize)]
struct TwitchUsers {
    data: Vec<TwitchUser>,
}

#[derive(Deserialize)]
struct TwitchUser {
    id: String,
    login: String,
    display_name: String,
    profile_image_url: Option<String>,
}

async fn twitch_callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let twitch = state
        .config
        .twitch
        .as_ref()
        .ok_or(ApiError::SignInUnavailable)?;

    if query.error.is_some() {
        return Ok(
            Redirect::to(&format!("{}#/account?error=denied", state.config.app_url))
                .into_response(),
        );
    }

    let (Some(code), Some(handshake)) = (query.code, query.state) else {
        return Err(ApiError::BadRequest("missing code or state"));
    };

    let secure = !state.config.insecure_cookies;

    // The state proves the handshake is one this server started. The cookie
    // proves it is the one *this browser* started — without it, an attacker
    // could hand a victim a callback URL for the attacker's own Twitch account
    // and the victim would silently end up signed in as them.
    //
    // Checked before the code is exchanged: an unbound callback costs Twitch
    // nothing and tells the caller nothing.
    let binding = cookie(&headers, auth::oauth_cookie_name(secure))
        .ok_or(ApiError::BadRequest("unknown or expired sign-in attempt"))?;

    let verifier = auth::take_oauth(&state.pool, &handshake, &binding)
        .await?
        .ok_or(ApiError::BadRequest("unknown or expired sign-in attempt"))?;

    let tokens: TwitchTokens = state
        .http
        .post("https://id.twitch.tv/oauth2/token")
        .form(&[
            ("client_id", twitch.client_id.as_str()),
            ("client_secret", twitch.client_secret.as_str()),
            ("code", code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &state.config.redirect_uri()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|error| ApiError::Other(error.into()))?
        .error_for_status()
        .map_err(|error| ApiError::Other(error.into()))?
        .json()
        .await
        .map_err(|error| ApiError::Other(error.into()))?;

    let profile: TwitchUsers = state
        .http
        .get("https://api.twitch.tv/helix/users")
        .header("Client-Id", &twitch.client_id)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|error| ApiError::Other(error.into()))?
        .error_for_status()
        .map_err(|error| ApiError::Other(error.into()))?
        .json()
        .await
        .map_err(|error| ApiError::Other(error.into()))?;

    let profile = profile
        .data
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Other(anyhow::anyhow!("Twitch returned no profile")))?;

    let user = db::upsert_user(
        &state.pool,
        &profile.id,
        &profile.login,
        &profile.display_name,
        profile.profile_image_url.as_deref(),
    )
    .await?;

    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok());

    let session =
        auth::create_session(&state.pool, user.id, state.config.session_ttl, user_agent).await?;

    let max_age = i64::try_from(state.config.session_ttl.as_secs()).unwrap_or(i64::MAX);
    let session_cookie = auth::cookie(
        auth::session_cookie_name(secure),
        &session.token,
        max_age,
        secure,
    );
    // The handshake is spent; the cookie that bound it has no further use.
    let spent = auth::cookie(auth::oauth_cookie_name(secure), "", 0, secure);

    Ok((
        [
            (header::SET_COOKIE, session_cookie),
            (header::SET_COOKIE, spent),
        ],
        Redirect::to(&format!("{}#/account", state.config.app_url)),
    )
        .into_response())
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let secure = !state.config.insecure_cookies;
    let name = auth::session_cookie_name(secure);

    if let Some(token) = cookie(&headers, name) {
        auth::revoke_session(&state.pool, &token).await?;
    }

    let cleared = auth::cookie(name, "", 0, secure);
    Ok(([(header::SET_COOKIE, cleared)], StatusCode::NO_CONTENT).into_response())
}

/// Reads one cookie by name. The first match wins, which is why the production
/// cookie names carry the `__Host-` prefix: it stops anything but this exact
/// host from setting a second cookie of the same name.
fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_string())
}

async fn me(Auth(user): Auth) -> Json<Value> {
    Json(json!({ "user": user }))
}

/// Deletes the account and everything attached to it. Nothing is kept.
async fn delete_me(State(state): State<AppState>, Auth(user): Auth) -> ApiResult<Response> {
    db::delete_user(&state.pool, user.id).await?;

    let secure = !state.config.insecure_cookies;
    let cleared = auth::cookie(auth::session_cookie_name(secure), "", 0, secure);
    Ok(([(header::SET_COOKIE, cleared)], StatusCode::NO_CONTENT).into_response())
}

// --- boards -----------------------------------------------------------------

fn summarise(row: &BoardRow) -> BoardSummary {
    BoardSummary {
        id: row.id,
        title: row.title.clone(),
        is_public: row.is_public,
        item_count: row.item_count,
        updated_at: row.updated_at,
    }
}

async fn list_boards(State(state): State<AppState>, Auth(user): Auth) -> ApiResult<Json<Value>> {
    let boards = db::boards_for_owner(&state.pool, user.id).await?;
    Ok(Json(json!({
        "boards": boards.iter().map(summarise).collect::<Vec<_>>(),
    })))
}

/// Validates, then stores. The order matters: nothing unvalidated reaches the
/// database, and the item count the client claims is ignored in favour of the
/// one counted here.
fn check(payload: &SaveBoard) -> ApiResult<i32> {
    if payload.title.trim().is_empty() || payload.title.chars().count() > board::limits::TITLE {
        return Err(ApiError::BadRequest("title must be 1 to 120 characters"));
    }

    let serialised = serde_json::to_vec(&payload.document)
        .map_err(|_| ApiError::BadRequest("board is not serialisable"))?;

    if serialised.len() > board::limits::DOCUMENT_BYTES {
        return Err(ApiError::BadRequest("board is too large"));
    }

    let items = board::validate(&payload.document)
        .map_err(|_| ApiError::BadRequest("board failed validation"))?;

    i32::try_from(items).map_err(|_| ApiError::BadRequest("board has too many items"))
}

/// 32 unambiguous symbols: a power of two, so sampling is unbiased, and no
/// 0/o or 1/l to misread when someone types a public link from a stream.
const SLUG_ALPHABET: &[u8; 32] = b"abcdefghijkmnpqrstuvwxyz23456789";
const SLUG_LENGTH: usize = 16;

/// A public identifier for a board: 80 bits, independent of the title.
///
/// Built from the alphabet directly rather than by filtering base64 — filtering
/// made the length vary, and anything under twelve characters is rejected by the
/// database constraint. The tests below are what caught that.
fn slug() -> String {
    let mut bytes = [0u8; SLUG_LENGTH];
    rand::rng().fill_bytes(&mut bytes);

    bytes
        .iter()
        .map(|byte| char::from(SLUG_ALPHABET[usize::from(*byte) % SLUG_ALPHABET.len()]))
        .collect()
}

async fn save_board(
    State(state): State<AppState>,
    Auth(user): Auth,
    Json(payload): Json<SaveBoard>,
) -> ApiResult<(StatusCode, Json<BoardSummary>)> {
    let item_count = check(&payload)?;

    let created = db::insert_board_within_quota(
        &state.pool,
        &db::NewBoard {
            owner_id: user.id,
            title: payload.title.trim(),
            slug: &slug(),
            is_public: payload.is_public,
            item_count,
            document: &payload.document,
        },
        state.config.storage_quota_bytes,
    )
    .await?;

    let row = match created {
        Ok(row) => row,
        Err(db::QuotaDenial::Count) => return Err(ApiError::QuotaExceeded),
        Err(db::QuotaDenial::Storage) => return Err(ApiError::StorageExceeded),
    };

    publish_overlay(&state, user.id, &row);
    Ok((StatusCode::CREATED, Json(summarise(&row))))
}

async fn get_board(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    let row = db::board_by_id(&state.pool, id)
        .await?
        .ok_or(ApiError::NotFound)?;

    // A board that is not yours is "not found", not "forbidden": the difference
    // would confirm the id exists.
    if row.owner_id != user.id {
        return Err(ApiError::NotFound);
    }

    Ok(Json(
        json!({ "board": summarise(&row), "document": row.document }),
    ))
}

async fn update_board(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<Uuid>,
    Json(payload): Json<SaveBoard>,
) -> ApiResult<Json<BoardSummary>> {
    let item_count = check(&payload)?;

    let row = db::update_board(
        &state.pool,
        id,
        user.id,
        payload.title.trim(),
        payload.is_public,
        item_count,
        &payload.document,
    )
    .await?
    .ok_or(ApiError::NotFound)?;

    publish_overlay(&state, user.id, &row);
    Ok(Json(summarise(&row)))
}

async fn remove_board(
    State(state): State<AppState>,
    Auth(user): Auth,
    Path(id): Path<Uuid>,
) -> ApiResult<StatusCode> {
    if db::delete_board(&state.pool, id, user.id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::NotFound)
    }
}

// --- public -----------------------------------------------------------------

#[derive(Serialize)]
struct PublicProfile {
    login: String,
    display_name: String,
    avatar_url: Option<String>,
    boards: Vec<PublicBoard>,
}

#[derive(Serialize)]
struct PublicBoard {
    slug: String,
    title: String,
    item_count: i32,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: time::OffsetDateTime,
}

/// A Twitch login, as the database constrains it. Anything else cannot name a
/// user, so it is "not found" without a query — and a NUL byte, which Postgres
/// refuses outright, never becomes a 500.
fn is_login_shaped(login: &str) -> bool {
    (1..=25).contains(&login.len())
        && login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// A slug as [`slug`] emits it and the database constrains it.
fn is_slug_shaped(slug: &str) -> bool {
    (12..=32).contains(&slug.len())
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

async fn public_profile(
    State(state): State<AppState>,
    Path(login): Path<String>,
) -> ApiResult<Json<PublicProfile>> {
    if !is_login_shaped(&login) {
        return Err(ApiError::NotFound);
    }

    let user = db::user_by_login(&state.pool, &login)
        .await?
        .ok_or(ApiError::NotFound)?;

    let boards = db::public_boards_for_owner(&state.pool, user.id).await?;

    Ok(Json(PublicProfile {
        login: user.login,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        boards: boards
            .into_iter()
            .map(|row| PublicBoard {
                slug: row.slug,
                title: row.title,
                item_count: row.item_count,
                updated_at: row.updated_at,
            })
            .collect(),
    }))
}

async fn public_board(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> ApiResult<Json<Value>> {
    if !is_slug_shaped(&slug) {
        return Err(ApiError::NotFound);
    }

    let row = db::public_board_by_slug(&state.pool, &slug)
        .await?
        .ok_or(ApiError::NotFound)?;

    Ok(Json(
        json!({ "board": summarise(&row), "document": row.document }),
    ))
}

// --- live overlay -----------------------------------------------------------

fn publish_overlay(state: &AppState, user_id: Uuid, row: &BoardRow) {
    if let Ok(payload) = serde_json::to_string(&json!({
        "type": "board",
        "board": row.document,
    })) {
        state.overlay.publish(user_id, payload);
    }
}

async fn rotate_overlay_key(
    State(state): State<AppState>,
    Auth(user): Auth,
) -> ApiResult<Json<Value>> {
    let key = overlay::rotate_key(&state.pool, user.id).await?;
    Ok(Json(json!({
        "key": key,
        "url": format!("{}#/overlay/live/{}", state.config.app_url, key),
    })))
}

#[derive(Deserialize)]
struct OverlayQuery {
    key: String,
}

/// The feed an OBS Browser Source subscribes to.
///
/// Authenticated by the overlay key alone, because a Browser Source is a URL in
/// a text field and cannot carry a session. The key grants exactly one thing:
/// watching one streamer's board change.
async fn overlay_stream(
    State(state): State<AppState>,
    Query(query): Query<OverlayQuery>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let user_id = overlay::owner_of_key(&state.pool, &query.key)
        .await?
        .ok_or(ApiError::NotFound)?;

    let receiver = state.overlay.subscribe(user_id);
    let stream = async_stream::stream! {
        let mut receiver = receiver;
        loop {
            match receiver.recv().await {
                Ok(payload) => yield Ok(Event::default().data(payload)),
                // Lagged means this listener fell behind. The next board update
                // brings it back in sync, so waiting for it is correct.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{slug, urlencode};

    #[test]
    fn slugs_match_the_database_constraint() {
        // The constraint is `^[a-z0-9]{12,32}$`; a thousand draws is enough to
        // catch a generator whose length or alphabet wanders.
        for _ in 0..1_000 {
            let slug = slug();
            assert!(
                (12..=32).contains(&slug.len()),
                "{slug} has a bad length ({})",
                slug.len()
            );
            assert!(
                slug.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
                "{slug} has unexpected characters"
            );
        }
    }

    #[test]
    fn slugs_do_not_repeat() {
        let first = slug();
        assert_ne!(first, slug());
    }

    #[test]
    fn urlencoding_escapes_what_matters() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("https://x/y?z=1"), "https%3A%2F%2Fx%2Fy%3Fz%3D1");
        assert_eq!(urlencode("safe-_.~"), "safe-_.~");
    }
}
