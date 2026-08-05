//! Who is allowed to have an account here.
//!
//! Completing a Twitch handshake proves who somebody is. It does not entitle
//! them to storage on somebody else's server, and until this module existed the
//! two were the same thing: any of Twitch's users could sign in and receive the
//! full per-account quota on this instance.
//!
//! The policy is a mode rather than a hardcoded list, because the instance this
//! was written for intends to be public eventually and is not ready to be yet.
//! Opening it should be a configuration change, not a rewrite.
//!
//! Three rules shape the code below:
//!
//! 1. **The gate is on account *creation*, never on sign-in.** Somebody who
//!    already has an account keeps getting in when the mode tightens; closing
//!    registration must not lock out the people already using it.
//! 2. **The decision and the insert happen together**, in one transaction under
//!    a lock. An account cap that counts and then inserts has the same race the
//!    board quota had, and concurrent sign-ins are exactly how it would be found.
//! 3. **A refusal creates nothing.** No half-made user, no row to clean up.

use std::collections::BTreeSet;

use sqlx::PgPool;

use crate::db::User;

/// How this instance treats somebody signing in for the first time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// Anybody with a Twitch account. The public service.
    Open,
    /// Only logins named in the allow-list.
    Invite,
    /// Nobody new. Existing accounts continue to work.
    #[default]
    Closed,
}

impl std::str::FromStr for Mode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "open" => Ok(Self::Open),
            "invite" => Ok(Self::Invite),
            "closed" => Ok(Self::Closed),
            other => Err(format!(
                "unknown registration mode {other:?}: expected open, invite or closed"
            )),
        }
    }
}

/// The instance's admission policy, read once at startup.
#[derive(Debug, Clone)]
pub struct Policy {
    pub mode: Mode,
    /// Logins that may register under [`Mode::Invite`]. Lowercased.
    pub allowed: BTreeSet<String>,
    /// Logins that are administrators. Lowercased.
    pub admins: BTreeSet<String>,
    /// How many accounts this instance will hold, or none for no limit.
    ///
    /// A public instance needs this whether or not anybody abuses it: the disk
    /// is finite, every account carries a storage quota, and the product of the
    /// two is the number that matters. Refusing the two-hundredth sign-up is a
    /// far better failure than filling the disk at three in the morning.
    pub max_accounts: Option<i64>,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            mode: Mode::Closed,
            allowed: BTreeSet::new(),
            admins: BTreeSet::new(),
            max_accounts: None,
        }
    }
}

/// Splits a comma-separated setting into lowercased logins.
#[must_use]
pub fn logins(raw: &str) -> BTreeSet<String> {
    raw.split(',')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .collect()
}

impl Policy {
    /// Whether a login may create an account, ignoring the account cap.
    #[must_use]
    pub fn admits(&self, login: &str) -> bool {
        match self.mode {
            Mode::Open => true,
            Mode::Invite => self.allowed.contains(&login.to_ascii_lowercase()),
            Mode::Closed => false,
        }
    }

    #[must_use]
    pub fn is_admin(&self, login: &str) -> bool {
        self.admins.contains(&login.to_ascii_lowercase())
    }
}

/// Why somebody was turned away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// Registration is closed, or this login is not on the list.
    NotInvited,
    /// The instance is full.
    Full,
    /// The account exists but has been suspended.
    Suspended,
}

/// A Twitch identity, as the callback received it.
pub struct Identity<'a> {
    pub twitch_id: &'a str,
    pub login: &'a str,
    pub display_name: &'a str,
    pub avatar_url: Option<&'a str>,
}

/// Admits somebody, or refuses them — creating nothing if refused.
///
/// The whole decision runs in one transaction. New accounts serialise on an
/// advisory lock so that concurrent first-time sign-ins cannot both see room
/// under the cap and both take it; returning users never reach the lock, so the
/// common path costs nothing.
pub async fn admit(
    pool: &PgPool,
    policy: &Policy,
    identity: &Identity<'_>,
) -> sqlx::Result<Result<User, Refusal>> {
    let mut transaction = pool.begin().await?;

    let existing =
        sqlx::query_as::<_, Existing>("select suspended_at from users where twitch_id = $1")
            .bind(identity.twitch_id)
            .fetch_optional(&mut *transaction)
            .await?;

    // Already here. Tightening the mode must not lock out the people who are
    // already using the instance, so this path never consults the policy — only
    // suspension, which is the deliberate way to shut one account out.
    if let Some(existing) = &existing {
        if existing.suspended_at.is_some() {
            transaction.rollback().await?;
            return Ok(Err(Refusal::Suspended));
        }

        let refreshed = refresh(&mut transaction, policy, identity).await?;
        transaction.commit().await?;
        return Ok(Ok(refreshed));
    }

    if !policy.admits(identity.login) {
        transaction.rollback().await?;
        return Ok(Err(Refusal::NotInvited));
    }

    // From here on this is a new account, and the cap has to hold against
    // whatever else is signing up at the same moment. One fixed advisory key,
    // held for the transaction: creation is serialised, everything else is not.
    sqlx::query("select pg_advisory_xact_lock($1)")
        .bind(ACCOUNT_LOCK)
        .execute(&mut *transaction)
        .await?;

    if let Some(max) = policy.max_accounts {
        let count: i64 = sqlx::query_scalar("select count(*) from users")
            .fetch_one(&mut *transaction)
            .await?;

        if count >= max {
            transaction.rollback().await?;
            return Ok(Err(Refusal::Full));
        }
    }

    let created = refresh(&mut transaction, policy, identity).await?;
    transaction.commit().await?;
    Ok(Ok(created))
}

/// Just enough of an existing row to decide what to do with it.
#[derive(sqlx::FromRow)]
struct Existing {
    suspended_at: Option<time::OffsetDateTime>,
}

/// The advisory lock new accounts serialise on. Arbitrary but fixed; nothing
/// else in this application takes an advisory lock.
const ACCOUNT_LOCK: i64 = 0x7261_6e6b; // "rank"

/// Creates or refreshes the row, and applies the admin list.
///
/// Admin status is re-derived from configuration on every sign-in rather than
/// stored once: the answer to "who administers this instance" then lives in the
/// deployment, and removing a login from `ADMIN_LOGINS` actually removes them.
async fn refresh(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    policy: &Policy,
    identity: &Identity<'_>,
) -> sqlx::Result<User> {
    // Twitch releases a login when its owner renames, and somebody else can
    // take it. The row that still holds it is stale, but `users_login_lower_idx`
    // does not know that — without this the rightful new owner's sign-in fails
    // on a unique constraint, which reaches them as a 500 they cannot act on.
    //
    // The stale row keeps its account and its boards; only the display of its
    // login changes, and its own next sign-in restores that from Twitch.
    sqlx::query(
        r"
        update users
        set login = 'stale_' || left(twitch_id, 19)
        where lower(login) = lower($1) and twitch_id <> $2
        ",
    )
    .bind(identity.login)
    .bind(identity.twitch_id)
    .execute(&mut **transaction)
    .await?;

    sqlx::query_as::<_, User>(
        r"
        insert into users (twitch_id, login, display_name, avatar_url, is_admin)
        values ($1, $2, $3, $4, $5)
        on conflict (twitch_id) do update
            set login = excluded.login,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url,
                is_admin = excluded.is_admin,
                last_seen_at = now()
        returning id, twitch_id, login, display_name, avatar_url
        ",
    )
    .bind(identity.twitch_id)
    .bind(identity.login)
    .bind(identity.display_name)
    .bind(identity.avatar_url)
    .bind(policy.is_admin(identity.login))
    .fetch_one(&mut **transaction)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(mode: Mode, allowed: &str) -> Policy {
        Policy {
            mode,
            allowed: logins(allowed),
            admins: logins("boss"),
            max_accounts: None,
        }
    }

    #[test]
    fn open_admits_anybody() {
        let policy = policy(Mode::Open, "");
        assert!(policy.admits("stranger"));
    }

    #[test]
    fn closed_admits_nobody() {
        let policy = policy(Mode::Closed, "friend");
        assert!(!policy.admits("friend"), "closed means closed");
        assert!(!policy.admits("stranger"));
    }

    #[test]
    fn invite_admits_only_the_list_and_ignores_case() {
        let policy = policy(Mode::Invite, "Friend, Other");

        assert!(policy.admits("friend"));
        assert!(
            policy.admits("FRIEND"),
            "Twitch logins are case-insensitive"
        );
        assert!(policy.admits("other"));
        assert!(!policy.admits("stranger"));
    }

    #[test]
    fn the_list_tolerates_the_way_people_write_lists() {
        let parsed = logins(" Alice ,,BOB,\n carol ,");
        assert_eq!(
            parsed.iter().map(String::as_str).collect::<Vec<_>>(),
            ["alice", "bob", "carol"]
        );
    }

    #[test]
    fn admins_are_recognised_regardless_of_mode() {
        for mode in [Mode::Open, Mode::Invite, Mode::Closed] {
            assert!(policy(mode, "").is_admin("BOSS"));
            assert!(!policy(mode, "").is_admin("someone"));
        }
    }

    #[test]
    fn modes_parse_from_configuration() {
        assert_eq!("open".parse(), Ok(Mode::Open));
        assert_eq!(" Invite ".parse(), Ok(Mode::Invite));
        assert_eq!("CLOSED".parse(), Ok(Mode::Closed));
        assert!("public".parse::<Mode>().is_err());
    }

    #[test]
    fn the_default_is_the_safe_one() {
        // A deployment that forgets to configure this must not be open to the
        // whole of Twitch by accident.
        assert_eq!(Mode::default(), Mode::Closed);
        assert_eq!(Policy::default().mode, Mode::Closed);
    }
}
