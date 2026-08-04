//! Authorisation, against a real database.
//!
//! These are the tests that matter most: every one of them describes something
//! a hostile client would try. They run against Postgres rather than a mock,
//! because the guarantee being tested — "this row is not yours" — is enforced
//! partly by SQL, and a mock would happily agree with a wrong query.
//!
//! Set `TEST_DATABASE_URL` to run them; they are skipped otherwise so a
//! contributor without Postgres can still run `cargo test`.

use rankroom_server::{auth, board, db, overlay};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let pool = PgPool::connect(&url)
        .await
        .expect("connect to test database");
    rankroom_server::migrate(&pool).await.expect("migrate");
    Some(pool)
}

/// A fresh user, so tests never collide on Twitch ids.
async fn user(pool: &PgPool, name: &str) -> db::User {
    let unique = Uuid::new_v4().simple().to_string();
    db::upsert_user(
        pool,
        &unique,
        &format!("{name}{}", &unique[..6]),
        name,
        None,
    )
    .await
    .expect("create user")
}

fn document() -> serde_json::Value {
    json!({
        "schema": 1,
        "title": "Board",
        "tiers": [{ "id": "t1", "label": "S", "color": "#ffffff", "itemIds": [] }],
        "bench": [],
        "items": []
    })
}

async fn board_for(pool: &PgPool, owner: &db::User, public: bool) -> db::BoardRow {
    let slug: String = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(16)
        .collect();
    db::insert_board(
        pool,
        &db::NewBoard {
            owner_id: owner.id,
            title: "Board",
            slug: &slug,
            is_public: public,
            item_count: 0,
            document: &document(),
        },
    )
    .await
    .expect("insert board")
}

macro_rules! db_test {
    ($name:ident, $pool:ident, $body:block) => {
        #[tokio::test]
        async fn $name() {
            let Some($pool) = pool().await else {
                eprintln!(
                    "skipping {}: TEST_DATABASE_URL is not set",
                    stringify!($name)
                );
                return;
            };
            $body
        }
    };
}

db_test!(a_user_cannot_read_another_users_board, pool, {
    let alice = user(&pool, "alice").await;
    let bob = user(&pool, "bob").await;
    let secret = board_for(&pool, &alice, false).await;

    // The row is reachable by id, which is exactly why the handler must check
    // ownership rather than trusting the lookup.
    let row = db::board_by_id(&pool, secret.id).await.unwrap().unwrap();
    assert_eq!(row.owner_id, alice.id);
    assert_ne!(row.owner_id, bob.id);

    let bobs = db::boards_for_owner(&pool, bob.id).await.unwrap();
    assert!(
        bobs.is_empty(),
        "bob must not see alice's board in his list"
    );
});

db_test!(a_user_cannot_update_another_users_board, pool, {
    let alice = user(&pool, "alice").await;
    let bob = user(&pool, "bob").await;
    let victim = board_for(&pool, &alice, false).await;

    let attempt = db::update_board(&pool, victim.id, bob.id, "Owned", true, 0, &document())
        .await
        .unwrap();
    assert!(attempt.is_none(), "the update must not match any row");

    let after = db::board_by_id(&pool, victim.id).await.unwrap().unwrap();
    assert_eq!(after.title, "Board", "the title must be untouched");
    assert!(!after.is_public, "it must not have been published");
});

db_test!(a_user_cannot_delete_another_users_board, pool, {
    let alice = user(&pool, "alice").await;
    let bob = user(&pool, "bob").await;
    let victim = board_for(&pool, &alice, false).await;

    assert!(!db::delete_board(&pool, victim.id, bob.id).await.unwrap());
    assert!(db::board_by_id(&pool, victim.id).await.unwrap().is_some());

    // The owner still can.
    assert!(db::delete_board(&pool, victim.id, alice.id).await.unwrap());
});

db_test!(a_private_board_is_not_reachable_by_slug, pool, {
    let alice = user(&pool, "alice").await;
    let private = board_for(&pool, &alice, false).await;
    let public = board_for(&pool, &alice, true).await;

    assert!(db::public_board_by_slug(&pool, &private.slug)
        .await
        .unwrap()
        .is_none());
    assert!(db::public_board_by_slug(&pool, &public.slug)
        .await
        .unwrap()
        .is_some());
});

db_test!(a_public_profile_lists_only_public_boards, pool, {
    let alice = user(&pool, "alice").await;
    board_for(&pool, &alice, false).await;
    board_for(&pool, &alice, true).await;

    let visible = db::public_boards_for_owner(&pool, alice.id).await.unwrap();
    assert_eq!(visible.len(), 1);
    assert!(visible.iter().all(|row| row.is_public));

    let all = db::boards_for_owner(&pool, alice.id).await.unwrap();
    assert_eq!(all.len(), 2, "the owner still sees both");
});

db_test!(a_session_token_resolves_only_to_its_own_user, pool, {
    let alice = user(&pool, "alice").await;
    let bob = user(&pool, "bob").await;

    let session = auth::create_session(&pool, alice.id, std::time::Duration::from_secs(600), None)
        .await
        .unwrap();

    let resolved = auth::user_for_token(&pool, &session.token)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(resolved.id, alice.id);
    assert_ne!(resolved.id, bob.id);

    assert!(auth::user_for_token(&pool, "not-a-real-token")
        .await
        .unwrap()
        .is_none());
});

db_test!(an_expired_session_is_refused, pool, {
    let alice = user(&pool, "alice").await;
    let session = auth::create_session(&pool, alice.id, std::time::Duration::from_secs(0), None)
        .await
        .unwrap();

    assert!(
        auth::user_for_token(&pool, &session.token)
            .await
            .unwrap()
            .is_none(),
        "a session that expired must not authenticate anyone"
    );
});

db_test!(logging_out_revokes_the_token_immediately, pool, {
    let alice = user(&pool, "alice").await;
    let session = auth::create_session(&pool, alice.id, std::time::Duration::from_secs(600), None)
        .await
        .unwrap();

    auth::revoke_session(&pool, &session.token).await.unwrap();
    assert!(auth::user_for_token(&pool, &session.token)
        .await
        .unwrap()
        .is_none());
});

db_test!(the_raw_session_token_is_never_stored, pool, {
    let alice = user(&pool, "alice").await;
    let session = auth::create_session(&pool, alice.id, std::time::Duration::from_secs(600), None)
        .await
        .unwrap();

    // A database leak must not hand over usable sessions.
    let found: Option<i64> =
        sqlx::query_scalar("select 1 from sessions where encode(token_hash, 'escape') = $1")
            .bind(&session.token)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert!(found.is_none(), "the token must only exist hashed");
});

db_test!(an_oauth_state_can_only_be_used_once, pool, {
    let handshake = auth::begin_oauth(&pool, "verifier-value").await.unwrap();

    assert_eq!(
        auth::take_oauth(&pool, &handshake.state, &handshake.binding)
            .await
            .unwrap()
            .as_deref(),
        Some("verifier-value")
    );
    assert!(
        auth::take_oauth(&pool, &handshake.state, &handshake.binding)
            .await
            .unwrap()
            .is_none(),
        "replaying a handshake must fail"
    );
});

db_test!(
    an_oauth_state_is_useless_without_its_browser_binding,
    pool,
    {
        let handshake = auth::begin_oauth(&pool, "verifier-value").await.unwrap();

        // Someone holding the state — from a log, a referrer, the victim's history —
        // but not the cookie. They must not be able to finish the sign-in, and they
        // must not be able to burn the handshake either.
        assert!(
            auth::take_oauth(&pool, &handshake.state, "guessed-binding")
                .await
                .unwrap()
                .is_none(),
            "a handshake was completed without its binding"
        );

        // Nor does the binding alone do anything without the state.
        assert!(
            auth::take_oauth(&pool, "guessed-state", &handshake.binding)
                .await
                .unwrap()
                .is_none(),
            "a handshake was completed without its state"
        );

        // And the real owner is unaffected by both attempts.
        assert_eq!(
            auth::take_oauth(&pool, &handshake.state, &handshake.binding)
                .await
                .unwrap()
                .as_deref(),
            Some("verifier-value"),
            "a failed attack invalidated a legitimate handshake"
        );
    }
);

db_test!(deleting_an_account_removes_everything_attached, pool, {
    let alice = user(&pool, "alice").await;
    board_for(&pool, &alice, true).await;
    auth::create_session(&pool, alice.id, std::time::Duration::from_secs(600), None)
        .await
        .unwrap();
    overlay::rotate_key(&pool, alice.id).await.unwrap();

    db::delete_user(&pool, alice.id).await.unwrap();

    assert!(db::boards_for_owner(&pool, alice.id)
        .await
        .unwrap()
        .is_empty());

    let sessions: i64 = sqlx::query_scalar("select count(*) from sessions where user_id = $1")
        .bind(alice.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 0, "sessions must not outlive the account");

    let keys: i64 = sqlx::query_scalar("select count(*) from overlay_keys where user_id = $1")
        .bind(alice.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(keys, 0, "overlay keys must not outlive the account");
});

db_test!(
    rotating_an_overlay_key_invalidates_the_previous_one,
    pool,
    {
        let alice = user(&pool, "alice").await;

        let first = overlay::rotate_key(&pool, alice.id).await.unwrap();
        assert_eq!(
            overlay::owner_of_key(&pool, &first).await.unwrap(),
            Some(alice.id)
        );

        let second = overlay::rotate_key(&pool, alice.id).await.unwrap();
        assert_ne!(first, second);
        assert!(
            overlay::owner_of_key(&pool, &first)
                .await
                .unwrap()
                .is_none(),
            "the old key must stop working the moment it is rotated"
        );
        assert_eq!(
            overlay::owner_of_key(&pool, &second).await.unwrap(),
            Some(alice.id)
        );
    }
);

db_test!(an_overlay_key_resolves_only_to_its_own_streamer, pool, {
    let alice = user(&pool, "alice").await;
    let bob = user(&pool, "bob").await;

    let alices = overlay::rotate_key(&pool, alice.id).await.unwrap();
    overlay::rotate_key(&pool, bob.id).await.unwrap();

    assert_eq!(
        overlay::owner_of_key(&pool, &alices).await.unwrap(),
        Some(alice.id)
    );
});

db_test!(
    the_database_refuses_a_board_the_application_would_reject,
    pool,
    {
        let alice = user(&pool, "alice").await;

        // Defence in depth: even if a handler forgot to validate, this fails.
        let bad = json!({ "schema": 2, "tiers": [], "items": [] });
        let slug: String = Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(16)
            .collect();

        let result = db::insert_board(
            &pool,
            &db::NewBoard {
                owner_id: alice.id,
                title: "Bad",
                slug: &slug,
                is_public: false,
                item_count: 0,
                document: &bad,
            },
        )
        .await;
        assert!(result.is_err(), "the schema constraint must reject this");

        // And the application layer refuses it first.
        assert!(board::validate(&bad).is_err());
    }
);
