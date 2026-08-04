//! Property testing for the board validator, with no database in the way.
//!
//! The handwritten tests check the cases someone thought of. This file checks
//! the ones nobody did: tens of thousands of pseudo-random documents, built to
//! land near the edges of the grammar rather than uniformly across JSON, where
//! almost every draw would be rejected for the same boring reason.
//!
//! Three properties, and they are the whole point:
//!
//! 1. Validation never panics. A panic inside a handler is a 500 at best and a
//!    downed worker at worst, and the input is attacker-controlled.
//! 2. Validation always terminates. A recursive structure must not become
//!    unbounded work.
//! 3. Whatever it accepts carries no image that is not inline raster data —
//!    the one rule whose failure is an XSS in every client that renders a board.
//!
//! The seed is fixed, so a failure is reproducible; `FUZZ_ITERATIONS` and
//! `FUZZ_SEED` override the defaults for a longer soak.

use rankroom_server::board;
use serde_json::{json, Value};

/// A small deterministic generator. `rand` would work, but a hand-rolled
/// xorshift keeps the corpus stable across dependency upgrades — a fuzz corpus
/// that silently changes shape is one that silently stops testing what it did.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % bound as u64).unwrap_or(0)
    }

    fn chance(&mut self, one_in: usize) -> bool {
        self.below(one_in) == 0
    }

    fn pick<'a, T>(&mut self, options: &'a [T]) -> &'a T {
        &options[self.below(options.len())]
    }
}

/// Strings chosen to sit on the boundary of whatever limit applies to the field.
///
/// The `max` matters more than it looks: tier labels cap at twelve characters,
/// so a generator that reached for two hundred would have every tier rejected
/// for length and never exercise anything else. The first version of this file
/// did exactly that and accepted 0.7% of its corpus.
fn string(rng: &mut Rng, max: usize) -> Value {
    const SAMPLES: [&str; 14] = [
        "",
        " ",
        "S",
        "normal label",
        "\u{0}",
        "\u{202e}override",
        "🎮🎮🎮",
        "<script>alert(1)</script>",
        "'; drop table boards; --",
        "\r\nSet-Cookie: x=y",
        "../../etc/passwd",
        "\u{feff}",
        "%00",
        "\\u0000",
    ];

    match rng.below(8) {
        // Hostile content, truncated to fit: the point is the characters, not
        // the length, and the length has its own cases below.
        0 => json!(rng.pick(&SAMPLES).chars().take(max).collect::<String>()),
        1 => json!(rng.pick(&SAMPLES)),
        // Exactly at the limit, and one past it.
        2 => json!("x".repeat(max)),
        3 => json!("x".repeat(max + 1)),
        _ => json!("x".repeat(rng.below(max + 1))),
    }
}

/// Image values, weighted so that roughly half are the hostile shapes.
fn image(rng: &mut Rng) -> Value {
    const HOSTILE: [&str; 10] = [
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        " javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "data:image/svg+xml,<svg onload=alert(1)>",
        "data:image/png;base64,",
        "data:image/png;base64,not base64!!",
        "https://evil.example/x.png",
        "//evil.example/x.png",
        "vbscript:msgbox(1)",
    ];
    const BENIGN: [&str; 3] = [
        "data:image/png;base64,iVBORw0KGgo=",
        "data:image/webp;base64,UklGRg==",
        "data:image/jpeg;base64,/9j/4AAQ",
    ];

    match rng.below(3) {
        0 => json!(rng.pick(&HOSTILE)),
        1 => json!(rng.pick(&BENIGN)),
        _ => match rng.below(4) {
            0 => Value::Null,
            1 => json!(42),
            2 => json!({ "url": "data:image/png;base64,AAAA" }),
            _ => string(rng, board::limits::LABEL),
        },
    }
}

/// Any JSON value, with a bounded chance of nesting.
fn any(rng: &mut Rng, depth: usize) -> Value {
    if depth == 0 || rng.chance(3) {
        return match rng.below(6) {
            0 => Value::Null,
            1 => json!(rng.next() as i64),
            2 => json!(true),
            3 => json!(f64::from(u32::try_from(rng.below(1000)).unwrap_or(0))),
            4 => json!([]),
            _ => string(rng, board::limits::LABEL),
        };
    }

    if rng.chance(2) {
        let length = rng.below(4);
        json!((0..length).map(|_| any(rng, depth - 1)).collect::<Vec<_>>())
    } else {
        let mut object = serde_json::Map::new();
        for _ in 0..rng.below(4) {
            let key = format!("k{}", rng.below(8));
            object.insert(key, any(rng, depth - 1));
        }
        Value::Object(object)
    }
}

fn tier(rng: &mut Rng) -> Value {
    if rng.chance(8) {
        return any(rng, 2);
    }

    let mut tier = serde_json::Map::new();
    if !rng.chance(6) {
        tier.insert("id".into(), string(rng, board::limits::LABEL));
    }
    if !rng.chance(6) {
        tier.insert("label".into(), string(rng, board::limits::TIER_LABEL));
    }
    if rng.chance(3) {
        tier.insert("label".into(), any(rng, 1));
    }
    if !rng.chance(4) {
        tier.insert(
            "itemIds".into(),
            json!((0..rng.below(5))
                .map(|_| string(rng, board::limits::LABEL))
                .collect::<Vec<_>>()),
        );
    }
    if rng.chance(5) {
        tier.insert("itemIds".into(), string(rng, board::limits::LABEL));
    }
    Value::Object(tier)
}

fn item(rng: &mut Rng) -> Value {
    if rng.chance(8) {
        return any(rng, 2);
    }

    let mut item = serde_json::Map::new();
    if !rng.chance(6) {
        item.insert("id".into(), string(rng, board::limits::LABEL));
    }
    if !rng.chance(4) {
        item.insert("label".into(), string(rng, board::limits::LABEL));
    }
    if !rng.chance(2) {
        item.insert("image".into(), image(rng));
    }
    if rng.chance(4) {
        item.insert("note".into(), any(rng, 2));
    }
    Value::Object(item)
}

fn document(rng: &mut Rng) -> Value {
    if rng.chance(20) {
        return any(rng, 4);
    }

    let mut document = serde_json::Map::new();

    // Mostly the schema the validator expects, so the generator spends its time
    // past the version gate rather than bouncing off it.
    if rng.chance(10) {
        document.insert("schema".into(), any(rng, 1));
    } else {
        document.insert("schema".into(), json!(1));
    }

    if !rng.chance(5) {
        document.insert("title".into(), string(rng, board::limits::TITLE));
    }
    if rng.chance(3) {
        document.insert("subtitle".into(), string(rng, board::limits::SUBTITLE));
    }

    if rng.chance(8) {
        document.insert("tiers".into(), any(rng, 2));
    } else {
        let count = if rng.chance(6) {
            rng.below(40)
        } else {
            1 + rng.below(6)
        };
        document.insert(
            "tiers".into(),
            json!((0..count).map(|_| tier(rng)).collect::<Vec<_>>()),
        );
    }

    if rng.chance(8) {
        document.insert("items".into(), any(rng, 2));
    } else {
        let count = if rng.chance(10) {
            rng.below(500)
        } else {
            rng.below(12)
        };
        document.insert(
            "items".into(),
            json!((0..count).map(|_| item(rng)).collect::<Vec<_>>()),
        );
    }

    if rng.chance(4) {
        document.insert("bench".into(), any(rng, 2));
    }
    if rng.chance(6) {
        document.insert(format!("extra{}", rng.below(5)), any(rng, 3));
    }

    Value::Object(document)
}

/// Everything the client must never be able to smuggle into an `<img src>`.
fn is_inert_image(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        // A non-string image is not a URL and cannot be rendered as one.
        return true;
    };

    const ALLOWED: [&str; 4] = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
    ];

    ALLOWED.iter().any(|prefix| {
        text.strip_prefix(prefix).is_some_and(|payload| {
            !payload.is_empty()
                && payload
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
        })
    })
}

fn setting(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(fallback)
}

#[test]
fn validation_survives_arbitrary_documents() {
    let iterations = setting("FUZZ_ITERATIONS", 50_000);
    let mut rng = Rng(setting("FUZZ_SEED", 0x5EED_1234_ABCD_0001));

    let mut accepted = 0_u64;
    let mut rejected = 0_u64;

    for round in 0..iterations {
        let document = document(&mut rng);

        // Property 1 and 2: it returns, without panicking. `catch_unwind` would
        // be redundant — a panic here fails the test by unwinding it — but the
        // round number makes any failure reproducible from the seed.
        match board::validate(&document) {
            Err(_) => rejected += 1,
            Ok(items) => {
                accepted += 1;

                // Property 3: nothing accepted may carry a live URL.
                let carried = document
                    .get("items")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or_default();

                assert!(
                    items <= board::limits::ITEMS,
                    "round {round}: reported {items} items, over the cap"
                );
                assert_eq!(
                    items,
                    carried.len(),
                    "round {round}: item count disagrees with the document"
                );

                for entry in carried {
                    if let Some(image) = entry.get("image") {
                        assert!(
                            is_inert_image(image),
                            "round {round}: accepted a live image URL: {image}"
                        );
                    }
                }
            }
        }
    }

    // A generator that only ever produced rejects would pass every assertion
    // above while testing nothing at all.
    assert!(
        accepted > iterations / 100,
        "only {accepted} of {iterations} documents were accepted: the corpus \
         is not reaching the validator's interesting paths"
    );
    assert!(
        rejected > 0,
        "nothing was rejected: the grammar is too loose"
    );
}

/// The depth at which `serde_json` gives up. Its default, not ours.
const PARSER_LIMIT: usize = 128;

#[test]
fn the_parser_is_what_bounds_nesting_and_it_still_does() {
    // This is the load-bearing assumption behind every depth question in this
    // server: no handler needs its own recursion check, because a request body
    // cannot become a value deeper than the parser will build.
    //
    // It is an assumption about a dependency's default, so it is asserted
    // rather than trusted. Turning on serde_json's `unbounded_depth` feature —
    // directly or through some future transitive default — would remove the
    // protection silently, and this test is what would notice.
    let ok = format!(
        "{}{}",
        "[".repeat(PARSER_LIMIT - 1),
        "]".repeat(PARSER_LIMIT - 1)
    );
    assert!(
        serde_json::from_str::<Value>(&ok).is_ok(),
        "the parser now refuses depths it used to accept"
    );

    for depth in [PARSER_LIMIT, PARSER_LIMIT + 1, 1_000, 50_000] {
        let bomb = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert!(
            serde_json::from_str::<Value>(&bomb).is_err(),
            "the parser accepted a {depth}-deep nesting bomb"
        );
    }
}

#[test]
fn validation_is_safe_at_the_deepest_a_request_can_reach() {
    // Built by parsing rather than by hand, because that is the only way a
    // document arrives here. A `serde_json::Value` nested thousands deep does
    // overflow the stack — on drop, inside serde_json, before this crate is
    // involved — but no request can produce one, and pretending otherwise would
    // be testing a threat that does not exist.
    let deepest = format!(
        "{}{}",
        "[".repeat(PARSER_LIMIT - 1),
        "]".repeat(PARSER_LIMIT - 1)
    );
    let nested: Value = serde_json::from_str(&deepest).expect("within the limit");

    let document = json!({
        "schema": 1,
        "tiers": [{ "id": "t", "label": "S" }],
        "items": [{ "id": "i", "label": "x", "image": nested.clone() }],
        "bench": nested,
    });

    // The assertion is that this returns at all, and refuses the nested image.
    assert!(
        board::validate(&document).is_err(),
        "an array was accepted as a tile image"
    );
}
