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

    let attempt = db::update_board_within_quota(
        &pool,
        &db::BoardEdit {
            id: victim.id,
            owner_id: bob.id,
            title: "Owned",
            is_public: true,
            item_count: 0,
            document: &document(),
        },
        i64::MAX,
    )
    .await
    .unwrap()
    .expect("quota is not the point of this test");

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

// --- admission ---------------------------------------------------------------
//
// Completing a Twitch handshake proves identity. It does not entitle anybody to
// storage on this server, and until there was a policy the two were the same
// thing. These tests describe what an instance owner would want to be true.

use rankroom_server::admission::{self, Identity, Mode, Policy, Refusal};

fn identity<'a>(twitch_id: &'a str, login: &'a str) -> Identity<'a> {
    Identity {
        twitch_id,
        login,
        display_name: "Someone",
        avatar_url: None,
    }
}

/// A login nothing else will have used. The test database outlives the run.
fn unique(prefix: &str) -> String {
    format!("{prefix}{}", &Uuid::new_v4().simple().to_string()[..8])
}

fn policy(mode: Mode) -> Policy {
    Policy {
        mode,
        ..Policy::default()
    }
}

db_test!(a_closed_instance_creates_no_account, pool, {
    let id = Uuid::new_v4().simple().to_string();
    let stranger = unique("stranger");

    let outcome = admission::admit(&pool, &policy(Mode::Closed), &identity(&id, &stranger))
        .await
        .unwrap();

    assert_eq!(outcome.err(), Some(Refusal::NotInvited));

    // A refusal must leave nothing behind — no half-made account, nothing to
    // clean up, and nothing that would let a second attempt slip through.
    let found: Option<Uuid> = sqlx::query_scalar("select id from users where twitch_id = $1")
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(found.is_none(), "a refused sign-in created a user row");
});

db_test!(an_invited_login_is_admitted_and_others_are_not, pool, {
    // Logins are unique per run: this database outlives the test binary, and a
    // fixed login would collide with the row a previous run left behind.
    let wanted = format!("wanted{}", &Uuid::new_v4().simple().to_string()[..8]);

    let invited = Policy {
        mode: Mode::Invite,
        allowed: admission::logins(&wanted),
        ..Policy::default()
    };

    let yes = admission::admit(
        &pool,
        &invited,
        &identity(&Uuid::new_v4().simple().to_string(), &wanted.to_uppercase()),
    )
    .await
    .unwrap();
    assert!(yes.is_ok(), "an invited login was refused");

    let no = admission::admit(
        &pool,
        &invited,
        &identity(&Uuid::new_v4().simple().to_string(), &unique("uninvited")),
    )
    .await
    .unwrap();
    assert_eq!(no.err(), Some(Refusal::NotInvited));
});

db_test!(
    closing_registration_does_not_lock_out_existing_accounts,
    pool,
    {
        // The subtle one. Tightening the mode is something an instance owner does
        // while people are already using the service; if it locked them out of
        // their own boards it would be unusable as a lever.
        let id = Uuid::new_v4().simple().to_string();
        let early = unique("early");

        let created = admission::admit(&pool, &policy(Mode::Open), &identity(&id, &early))
            .await
            .unwrap()
            .expect("open admits");

        for mode in [Mode::Closed, Mode::Invite] {
            let again = admission::admit(&pool, &policy(mode), &identity(&id, &early))
                .await
                .unwrap()
                .expect("an existing account was locked out");

            assert_eq!(
                again.id, created.id,
                "the same person got a different account"
            );
        }
    }
);

db_test!(
    a_suspended_account_cannot_sign_in_but_keeps_its_boards,
    pool,
    {
        let id = Uuid::new_v4().simple().to_string();
        let trouble = unique("trouble");
        let user = admission::admit(&pool, &policy(Mode::Open), &identity(&id, &trouble))
            .await
            .unwrap()
            .expect("admitted");

        let slug = format!("{:x}", Uuid::new_v4().simple());
        db::insert_board(
            &pool,
            &db::NewBoard {
                owner_id: user.id,
                title: "Theirs",
                slug: &slug,
                is_public: false,
                item_count: 0,
                document: &document(),
            },
        )
        .await
        .unwrap();

        sqlx::query("update users set suspended_at = now() where id = $1")
            .bind(user.id)
            .execute(&pool)
            .await
            .unwrap();

        let refused = admission::admit(&pool, &policy(Mode::Open), &identity(&id, &trouble))
            .await
            .unwrap();
        assert_eq!(refused.err(), Some(Refusal::Suspended));

        // Suspension is the reversible lever; deletion is the other one. It must
        // not quietly destroy anything, or it is just a slower delete.
        let boards: i64 = sqlx::query_scalar("select count(*) from boards where owner_id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(boards, 1, "suspending an account destroyed its boards");
    }
);

db_test!(
    the_account_cap_never_lets_more_than_one_take_the_last_slot,
    pool,
    {
        // The same shape of bug as the board quota: count, then insert, with a
        // window in between. Concurrent first-time sign-ups are exactly how a public
        // instance would find it.
        //
        // The assertion is "at most one", not "exactly one", and that is deliberate.
        // Every test in this file shares one database and several of them create
        // users, so the global count moves underneath this test and the exact number
        // admitted is not observable. What *is* observable is the direction that
        // matters: the cap must never let two through. Refusing everybody is
        // conservative and harmless; admitting two is the bug.
        let before: i64 = sqlx::query_scalar("select count(*) from users")
            .fetch_one(&pool)
            .await
            .unwrap();

        let capped = Policy {
            mode: Mode::Open,
            max_accounts: Some(before + 1),
            ..Policy::default()
        };

        let ids: Vec<String> = (0..12)
            .map(|_| Uuid::new_v4().simple().to_string())
            .collect();

        let attempts = ids.iter().enumerate().map(|(index, id)| {
            let pool = pool.clone();
            let capped = capped.clone();
            let login = format!("racer{index}");
            let id = id.clone();
            async move {
                admission::admit(&pool, &capped, &identity(&id, &login))
                    .await
                    .unwrap()
                    .is_ok()
            }
        });

        let admitted = futures_util::future::join_all(attempts)
            .await
            .into_iter()
            .filter(|ok| *ok)
            .count();

        // Counted from the rows rather than the return values, so a create that
        // reported failure but wrote anyway would still be caught.
        let created: i64 =
            sqlx::query_scalar("select count(*) from users where twitch_id = any($1)")
                .bind(&ids)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert!(admitted <= 1, "the cap admitted {admitted} of 12 racers");
        assert!(created <= 1, "the cap wrote {created} rows for 12 racers");
        assert_eq!(
            i64::try_from(admitted).unwrap(),
            created,
            "admissions and rows disagree"
        );
    }
);

db_test!(the_cap_admits_while_there_is_room, pool, {
    // The companion to the race above: without headroom the test there would
    // pass by refusing everybody for the wrong reason.
    let before: i64 = sqlx::query_scalar("select count(*) from users")
        .fetch_one(&pool)
        .await
        .unwrap();

    let roomy = Policy {
        mode: Mode::Open,
        max_accounts: Some(before + 1_000),
        ..Policy::default()
    };

    let outcome = admission::admit(
        &pool,
        &roomy,
        &identity(&Uuid::new_v4().simple().to_string(), &unique("spacious")),
    )
    .await
    .unwrap();

    assert!(
        outcome.is_ok(),
        "the cap refused somebody with room to spare"
    );
});

db_test!(a_full_instance_turns_everybody_away, pool, {
    let full = Policy {
        mode: Mode::Open,
        // Already at or over the limit, whatever the shared database holds.
        max_accounts: Some(0),
        ..Policy::default()
    };

    let outcome = admission::admit(
        &pool,
        &full,
        &identity(&Uuid::new_v4().simple().to_string(), &unique("latecomer")),
    )
    .await
    .unwrap();

    assert_eq!(outcome.err(), Some(Refusal::Full));
});

db_test!(
    administrators_are_named_by_configuration_not_by_a_row,
    pool,
    {
        let id = Uuid::new_v4().simple().to_string();
        let chief = unique("chief");

        let promoting = Policy {
            mode: Mode::Open,
            admins: admission::logins(&chief),
            ..Policy::default()
        };
        let user = admission::admit(&pool, &promoting, &identity(&id, &chief))
            .await
            .unwrap()
            .expect("admitted");

        let is_admin: bool = sqlx::query_scalar("select is_admin from users where id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(is_admin, "the admin list did not take effect");

        // Removing somebody from the list has to actually remove them. Storing the
        // flag once at creation would leave a former administrator administering.
        admission::admit(&pool, &policy(Mode::Open), &identity(&id, &chief))
            .await
            .unwrap()
            .expect("admitted");

        let still_admin: bool = sqlx::query_scalar("select is_admin from users where id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            !still_admin,
            "an administrator survived being taken off the list"
        );
    }
);

db_test!(
    a_login_reclaimed_on_twitch_does_not_break_its_new_owner,
    pool,
    {
        // Twitch releases a login when its owner renames, and somebody else can
        // take it. The row that still holds it is stale, but the unique index on
        // lower(login) does not know that — and without handling it, the rightful
        // new owner's sign-in dies on a constraint violation they see as a 500.
        let contested = unique("popular");

        let first = admission::admit(
            &pool,
            &policy(Mode::Open),
            &identity(&Uuid::new_v4().simple().to_string(), &contested),
        )
        .await
        .unwrap()
        .expect("the original owner");

        // Somebody else now signs in holding that same login on Twitch.
        let second = admission::admit(
            &pool,
            &policy(Mode::Open),
            &identity(&Uuid::new_v4().simple().to_string(), &contested),
        )
        .await
        .unwrap()
        .expect("the new owner was refused their own login");

        assert_ne!(first.id, second.id, "two Twitch accounts became one");
        assert_eq!(second.login, contested);

        // The previous holder keeps their account and their boards; only the login
        // moves, and their own next sign-in restores it from Twitch.
        let stale: String = sqlx::query_scalar("select login from users where id = $1")
            .bind(first.id)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_ne!(stale, contested);
        assert!(
            stale.starts_with("stale_"),
            "the displaced login became {stale}, which is not recognisable as displaced"
        );
        // Still a valid login as far as the database is concerned, or the row could
        // never be written back.
        assert!(
            stale.len() <= 25 && stale.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
            "the displaced login {stale} violates the login constraint"
        );
    }
);
