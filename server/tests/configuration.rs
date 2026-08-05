//! Every setting the server reads is one the deployment can actually set.
//!
//! `config.rs` and `compose.yaml` are two files joined by nothing but memory.
//! Adding a setting to one and forgetting the other produces a server that
//! silently runs on defaults — which is exactly what happened the first time
//! registration control shipped: the policy was read from `REGISTRATION`, the
//! compose file never passed it, and production quietly stayed closed while its
//! secrets said `invite`.
//!
//! That failure was harmless because the default is the safe one. The next such
//! omission might not be. This test is the link that was missing.

/// Read at compile time: the test binary has no working directory to rely on.
const CONFIG: &str = include_str!("../src/config.rs");
const COMPOSE: &str = include_str!("../../compose.yaml");

/// Settings deliberately absent from `compose.yaml`, each with its reason.
///
/// An exclusion has to be argued for, not just added to silence the test.
const NOT_IN_COMPOSE: [(&str, &str); 3] = [
    (
        "STATIC_DIR",
        "set in the Dockerfile: it names a path inside the image, not a choice \
         the operator makes",
    ),
    (
        "INSECURE_COOKIES",
        "local development only. Exposing it in compose invites somebody to set \
         it in production, which hands sessions to anyone on the network",
    ),
    (
        "ALLOWED_ORIGINS",
        "defaults to APP_URL's origin, which is right for the single-origin \
         deployment this compose file describes",
    ),
];

fn settings_read_by_the_server() -> Vec<String> {
    // `var("X")`, `optional("X")`, `parse("X", …)`, `parse::<T>("X", …)`.
    let mut found: Vec<String> = CONFIG
        .match_indices('"')
        .filter_map(|(at, _)| {
            let rest = &CONFIG[at + 1..];
            let end = rest.find('"')?;
            let name = &rest[..end];

            let is_setting = !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                && name.chars().next().is_some_and(|c| c.is_ascii_uppercase());

            // Only where it is being read from the environment.
            let before = &CONFIG[..at];
            let reading = before.ends_with("var(")
                || before.ends_with("optional(")
                || before.ends_with("parse(")
                || before.ends_with(">(");

            (is_setting && reading).then(|| name.to_string())
        })
        .collect();

    found.sort();
    found.dedup();
    found
}

#[test]
fn every_setting_the_server_reads_can_be_set_by_the_deployment() {
    let excluded: Vec<&str> = NOT_IN_COMPOSE.iter().map(|(name, _)| *name).collect();
    let mut missing = Vec::new();

    for setting in settings_read_by_the_server() {
        if excluded.contains(&setting.as_str()) {
            continue;
        }
        if !COMPOSE.contains(&format!("{setting}:")) {
            missing.push(setting);
        }
    }

    assert!(
        missing.is_empty(),
        "compose.yaml does not pass these settings, so the server runs on its \
         defaults no matter what the deployment sets: {missing:?}"
    );
}

#[test]
fn the_exclusions_still_describe_something_real() {
    // An exclusion for a setting that no longer exists is a stale argument, and
    // the next person reads it as a live one.
    let read = settings_read_by_the_server();

    for (setting, reason) in NOT_IN_COMPOSE {
        assert!(
            read.contains(&setting.to_string()),
            "{setting} is excluded from compose on the grounds that it {reason}, \
             but the server no longer reads it"
        );
    }
}

#[test]
fn the_scan_finds_settings_at_all() {
    // Every assertion above passes trivially against an empty list, which is the
    // worst way for this file to fail.
    let read = settings_read_by_the_server();

    assert!(read.len() > 10, "only found {read:?}");
    for expected in ["DATABASE_URL", "REGISTRATION", "PUBLIC_URL"] {
        assert!(
            read.contains(&expected.to_string()),
            "{expected} was not found"
        );
    }
}
