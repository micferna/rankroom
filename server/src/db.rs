use serde::Serialize;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::board::limits;

/// A signed-in person. Identity comes from Twitch; nothing here is a secret.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: Uuid,
    #[serde(skip_serializing)]
    pub twitch_id: String,
    pub login: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct BoardRow {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub slug: String,
    pub is_public: bool,
    pub item_count: i32,
    pub document: serde_json::Value,
    pub updated_at: OffsetDateTime,
}

/// Creates or refreshes a user with **no admission check at all**.
///
/// Request-handling code must go through [`crate::admission::admit`], which
/// decides whether this instance wants the account before creating it. This
/// function exists for tests that seed fixtures, and calling it from a route
/// would hand every Twitch user an account here.
///
/// Keyed on the Twitch id rather than the login: logins can be renamed, and
/// treating a rename as a new person would orphan their boards.
pub async fn upsert_user(
    pool: &PgPool,
    twitch_id: &str,
    login: &str,
    display_name: &str,
    avatar_url: Option<&str>,
) -> sqlx::Result<User> {
    sqlx::query_as::<_, User>(
        r"
        insert into users (twitch_id, login, display_name, avatar_url)
        values ($1, $2, $3, $4)
        on conflict (twitch_id) do update
            set login = excluded.login,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url,
                last_seen_at = now()
        returning id, twitch_id, login, display_name, avatar_url
        ",
    )
    .bind(twitch_id)
    .bind(login)
    .bind(display_name)
    .bind(avatar_url)
    .fetch_one(pool)
    .await
}

pub async fn user_by_login(pool: &PgPool, login: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>(
        "select id, twitch_id, login, display_name, avatar_url from users where lower(login) = lower($1)",
    )
    .bind(login)
    .fetch_optional(pool)
    .await
}

pub async fn delete_user(pool: &PgPool, user_id: Uuid) -> sqlx::Result<()> {
    // Sessions, boards and overlay keys cascade.
    sqlx::query("delete from users where id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn boards_for_owner(pool: &PgPool, owner_id: Uuid) -> sqlx::Result<Vec<BoardRow>> {
    sqlx::query_as::<_, BoardRow>(
        r"
        select id, owner_id, title, slug, is_public, item_count, document, updated_at
        from boards
        where owner_id = $1
        order by updated_at desc
        ",
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

pub async fn public_boards_for_owner(pool: &PgPool, owner_id: Uuid) -> sqlx::Result<Vec<BoardRow>> {
    sqlx::query_as::<_, BoardRow>(
        r"
        select id, owner_id, title, slug, is_public, item_count, document, updated_at
        from boards
        where owner_id = $1 and is_public
        order by updated_at desc
        ",
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

/// Fetches a board **without** checking who is asking. Callers must authorise.
pub async fn board_by_id(pool: &PgPool, id: Uuid) -> sqlx::Result<Option<BoardRow>> {
    sqlx::query_as::<_, BoardRow>(
        r"
        select id, owner_id, title, slug, is_public, item_count, document, updated_at
        from boards
        where id = $1
        ",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn public_board_by_slug(pool: &PgPool, slug: &str) -> sqlx::Result<Option<BoardRow>> {
    sqlx::query_as::<_, BoardRow>(
        r"
        select id, owner_id, title, slug, is_public, item_count, document, updated_at
        from boards
        where slug = $1 and is_public
        ",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await
}

/// What stopped a board from being created.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaDenial {
    /// Too many boards.
    Count,
    /// Too many bytes across all of them.
    Storage,
}

/// Inserts a board with no quota check at all.
///
/// Generic over the executor so the guarded path below can run it inside its
/// transaction rather than repeating the statement. Every request-handling
/// caller must go through [`insert_board_within_quota`]; this one exists for
/// that function and for tests that seed fixtures.
pub async fn insert_board<'e, E>(executor: E, board: &NewBoard<'_>) -> sqlx::Result<BoardRow>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query_as::<_, BoardRow>(
        r"
        insert into boards (owner_id, title, slug, is_public, item_count, document)
        values ($1, $2, $3, $4, $5, $6)
        returning id, owner_id, title, slug, is_public, item_count, document, updated_at
        ",
    )
    .bind(board.owner_id)
    .bind(board.title)
    .bind(board.slug)
    .bind(board.is_public)
    .bind(board.item_count)
    .bind(board.document)
    .fetch_one(executor)
    .await
}

/// A board on its way into the database, already validated.
pub struct NewBoard<'a> {
    pub owner_id: Uuid,
    pub title: &'a str,
    pub slug: &'a str,
    pub is_public: bool,
    pub item_count: i32,
    pub document: &'a serde_json::Value,
}

/// Creates a board, but only if the account is under both of its quotas.
///
/// Counting and then inserting in two statements is a race: twenty concurrent
/// requests all read the same count, all find room, and all insert. The pentest
/// suite does exactly that and drove the quota straight through on the first
/// run. So the count and the insert happen inside one transaction that first
/// takes a lock on the owner's row — board creation for one account is
/// serialised, and nothing else in the system contends for that lock.
pub async fn insert_board_within_quota(
    pool: &PgPool,
    board: &NewBoard<'_>,
    storage_quota_bytes: i64,
) -> sqlx::Result<Result<BoardRow, QuotaDenial>> {
    let NewBoard {
        owner_id, document, ..
    } = *board;

    let mut transaction = pool.begin().await?;

    // The gate. Every concurrent creation for this owner queues here.
    sqlx::query("select 1 from users where id = $1 for update")
        .bind(owner_id)
        .fetch_optional(&mut *transaction)
        .await?;

    let count: i64 = sqlx::query_scalar("select count(*) from boards where owner_id = $1")
        .bind(owner_id)
        .fetch_one(&mut *transaction)
        .await?;

    if count >= BOARD_QUOTA {
        transaction.rollback().await?;
        return Ok(Err(QuotaDenial::Count));
    }

    if !fits(
        &mut transaction,
        owner_id,
        None,
        document,
        storage_quota_bytes,
    )
    .await?
    {
        transaction.rollback().await?;
        return Ok(Err(QuotaDenial::Storage));
    }

    let row = insert_board(&mut *transaction, board).await?;

    transaction.commit().await?;
    Ok(Ok(row))
}

/// A board on its way back into the database, already validated.
pub struct BoardEdit<'a> {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: &'a str,
    pub is_public: bool,
    pub item_count: i32,
    pub document: &'a serde_json::Value,
}

/// Whether this account has room for `document`.
///
/// `replacing` names a board whose current bytes do not count, because they are
/// about to be replaced — without it an update would be measured against
/// storage that includes the very board being overwritten, and saving a board
/// twice in a row would eventually fail for no reason a user could understand.
///
/// A board count alone bounds nothing: two hundred boards of thirty megabytes
/// is still six gigabytes of somebody else's disk.
async fn fits(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner_id: Uuid,
    replacing: Option<Uuid>,
    document: &serde_json::Value,
    storage_quota_bytes: i64,
) -> sqlx::Result<bool> {
    let used: i64 = sqlx::query_scalar(
        r"
        select coalesce(sum(pg_column_size(document)), 0)::bigint
        from boards
        where owner_id = $1 and ($2::uuid is null or id <> $2)
        ",
    )
    .bind(owner_id)
    .bind(replacing)
    .fetch_one(&mut **transaction)
    .await?;

    let incoming = i64::try_from(document.to_string().len()).unwrap_or(i64::MAX);
    Ok(used.saturating_add(incoming) <= storage_quota_bytes)
}

/// Updates a board **only** when it belongs to `owner_id`, and only if it fits.
///
/// The quota check lives here rather than only on creation because otherwise it
/// is decorative: fill an account with boards small enough to be admitted, then
/// grow each one afterwards and never touch the create path again. A pentest
/// walked straight through it before this existed.
pub async fn update_board_within_quota(
    pool: &PgPool,
    edit: &BoardEdit<'_>,
    storage_quota_bytes: i64,
) -> sqlx::Result<Result<Option<BoardRow>, QuotaDenial>> {
    let BoardEdit {
        id,
        owner_id,
        title,
        is_public,
        item_count,
        document,
    } = *edit;

    let mut transaction = pool.begin().await?;

    // The same gate creation takes, so a create and an update racing each other
    // cannot both measure the account before either has written.
    sqlx::query("select 1 from users where id = $1 for update")
        .bind(owner_id)
        .fetch_optional(&mut *transaction)
        .await?;

    if !fits(
        &mut transaction,
        owner_id,
        Some(id),
        document,
        storage_quota_bytes,
    )
    .await?
    {
        transaction.rollback().await?;
        return Ok(Err(QuotaDenial::Storage));
    }

    let row = sqlx::query_as::<_, BoardRow>(
        r"
        update boards
        set title = $3, is_public = $4, item_count = $5, document = $6, updated_at = now()
        where id = $1 and owner_id = $2
        returning id, owner_id, title, slug, is_public, item_count, document, updated_at
        ",
    )
    .bind(id)
    .bind(owner_id)
    .bind(title)
    .bind(is_public)
    .bind(item_count)
    .bind(document)
    .fetch_optional(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(Ok(row))
}

pub async fn delete_board(pool: &PgPool, id: Uuid, owner_id: Uuid) -> sqlx::Result<bool> {
    sqlx::query("delete from boards where id = $1 and owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .execute(pool)
        .await
        .map(|done| done.rows_affected() > 0)
}

pub const BOARD_QUOTA: i64 = limits::BOARDS_PER_USER;

// --- administration ---------------------------------------------------------

/// One account, as an administrator needs to see it.
///
/// Deliberately no board titles and no board contents. Running an instance
/// requires knowing that an account exists and what it costs; it does not
/// require reading what people ranked, and an admin view that shows it invites
/// exactly that.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AccountSummary {
    pub id: Uuid,
    pub login: String,
    pub display_name: String,
    pub is_admin: bool,
    pub boards: i64,
    pub public_boards: i64,
    pub bytes: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub suspended_at: Option<OffsetDateTime>,
}

/// Every account, with what it is costing.
pub async fn accounts(pool: &PgPool) -> sqlx::Result<Vec<AccountSummary>> {
    sqlx::query_as::<_, AccountSummary>(
        r"
        select
            u.id,
            u.login,
            u.display_name,
            u.is_admin,
            count(b.id) as boards,
            count(b.id) filter (where b.is_public) as public_boards,
            coalesce(sum(pg_column_size(b.document)), 0)::bigint as bytes,
            u.created_at,
            u.last_seen_at,
            u.suspended_at
        from users u
        left join boards b on b.owner_id = u.id
        group by u.id
        order by u.created_at
        ",
    )
    .fetch_all(pool)
    .await
}

/// Suspends or restores an account.
///
/// Suspending revokes every session it holds in the same transaction. Without
/// that the person stays signed in until their cookie expires — up to a month —
/// which makes the lever useless in the situation it exists for.
pub async fn set_suspended(pool: &PgPool, user_id: Uuid, suspended: bool) -> sqlx::Result<bool> {
    let mut transaction = pool.begin().await?;

    let changed = sqlx::query(
        "update users set suspended_at = case when $2 then now() else null end where id = $1",
    )
    .bind(user_id)
    .bind(suspended)
    .execute(&mut *transaction)
    .await?
    .rows_affected()
        > 0;

    if suspended {
        sqlx::query("delete from sessions where user_id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
    }

    transaction.commit().await?;
    Ok(changed)
}

/// What the instance as a whole is holding.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct InstanceUsage {
    pub accounts: i64,
    pub boards: i64,
    pub bytes: i64,
}

pub async fn instance_usage(pool: &PgPool) -> sqlx::Result<InstanceUsage> {
    sqlx::query_as::<_, InstanceUsage>(
        r"
        select
            (select count(*) from users) as accounts,
            (select count(*) from boards) as boards,
            (select coalesce(sum(pg_column_size(document)), 0)::bigint from boards) as bytes
        ",
    )
    .fetch_one(pool)
    .await
}
