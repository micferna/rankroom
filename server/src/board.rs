use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Server-side validation of a board.
///
/// The browser already validates on the way in, but a client is not a security
/// boundary: anything reaching this server may have been crafted by hand. These
/// limits mirror `src/lib/schema.ts` so the two ends agree, and the server is
/// the one that decides.
///
/// Validation is structural rather than transformative: the stored document is
/// the caller's, minus anything that failed a rule. Rewriting it here would make
/// the two implementations drift the first time either changed.
pub mod limits {
    pub const TITLE: usize = 120;
    pub const SUBTITLE: usize = 160;
    pub const LABEL: usize = 80;
    pub const TIER_LABEL: usize = 12;
    pub const TIERS: usize = 26;
    pub const ITEMS: usize = 400;
    /// ~200 KB of base64 per tile, matching the client.
    pub const IMAGE: usize = 280_000;
    /// A whole board, serialised.
    ///
    /// Four hundred tiles at the per-image cap would be 112 MB, but a 320px WebP
    /// is 10–30 KB in practice, so that ceiling describes nothing anyone builds
    /// while forcing the server to buffer 112 MB per request. 32 MB still holds
    /// four hundred tiles at 80 KB each — generous — and cuts the worst case a
    /// single request can cost by three and a half times. The browser gets the
    /// matching check when the front end starts uploading; until then this is
    /// the only place it is enforced, which is the right place for it to be.
    pub const DOCUMENT_BYTES: usize = 32 * 1024 * 1024;
    pub const BOARDS_PER_USER: i64 = 200;
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BoardError {
    #[error("board is not an object")]
    NotAnObject,
    #[error("unsupported board version")]
    UnsupportedSchema,
    #[error("board has no tiers")]
    NoTiers,
    #[error("too many tiers")]
    TooManyTiers,
    #[error("too many items")]
    TooManyItems,
    #[error("a tile image is not inline image data")]
    BadImage,
    #[error("a field is longer than allowed")]
    TooLong,
    #[error("a field has the wrong type")]
    BadShape,
    #[error("board is too large")]
    TooLarge,
}

/// Only inline raster data. A `javascript:` or `data:text/html` value here would
/// be an XSS sink the moment the board is rendered.
fn is_inline_image(value: &str) -> bool {
    const PREFIXES: [&str; 4] = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
    ];

    let Some(prefix) = PREFIXES.iter().find(|prefix| value.starts_with(**prefix)) else {
        return false;
    };

    let payload = &value[prefix.len()..];
    !payload.is_empty()
        && payload.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'='
        })
}

fn text(value: Option<&Value>, max: usize) -> Result<(), BoardError> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(text)) if text.chars().count() <= max => Ok(()),
        Some(Value::String(_)) => Err(BoardError::TooLong),
        Some(_) => Err(BoardError::BadShape),
    }
}

/// Checks a board document. Returns the number of items, for quota reporting.
pub fn validate(document: &Value) -> Result<usize, BoardError> {
    let object = document.as_object().ok_or(BoardError::NotAnObject)?;

    if object.get("schema").and_then(Value::as_i64) != Some(1) {
        return Err(BoardError::UnsupportedSchema);
    }

    text(object.get("title"), limits::TITLE)?;
    text(object.get("subtitle"), limits::SUBTITLE)?;

    let tiers = object
        .get("tiers")
        .and_then(Value::as_array)
        .ok_or(BoardError::BadShape)?;

    if tiers.is_empty() {
        return Err(BoardError::NoTiers);
    }
    if tiers.len() > limits::TIERS {
        return Err(BoardError::TooManyTiers);
    }

    for tier in tiers {
        let tier = tier.as_object().ok_or(BoardError::BadShape)?;
        text(tier.get("label"), limits::TIER_LABEL)?;

        if tier.get("itemIds").is_some_and(|ids| !ids.is_array()) {
            return Err(BoardError::BadShape);
        }
    }

    let items = object
        .get("items")
        .and_then(Value::as_array)
        .ok_or(BoardError::BadShape)?;

    if items.len() > limits::ITEMS {
        return Err(BoardError::TooManyItems);
    }

    for item in items {
        let item = item.as_object().ok_or(BoardError::BadShape)?;
        text(item.get("label"), limits::LABEL)?;

        match item.get("image") {
            None | Some(Value::Null) => {}
            Some(Value::String(image)) => {
                if image.len() > limits::IMAGE {
                    return Err(BoardError::TooLong);
                }
                if !is_inline_image(image) {
                    return Err(BoardError::BadImage);
                }
            }
            Some(_) => return Err(BoardError::BadShape),
        }
    }

    Ok(items.len())
}

/// What a caller sends when saving.
///
/// `deny_unknown_fields` on purpose: `is_public` has a default, so a client that
/// misspelled it would silently get a private board and never learn why. A
/// privacy flag deserves a loud failure, not a quiet fallback.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveBoard {
    pub title: String,
    #[serde(default)]
    pub is_public: bool,
    pub document: Value,
}

/// What a caller gets back.
#[derive(Debug, Serialize)]
pub struct BoardSummary {
    pub id: uuid::Uuid,
    pub title: String,
    pub is_public: bool,
    pub item_count: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: time::OffsetDateTime,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn minimal() -> Value {
        json!({
            "schema": 1,
            "title": "Board",
            "tiers": [{ "id": "t1", "label": "S", "color": "#fff", "itemIds": [] }],
            "bench": [],
            "items": []
        })
    }

    #[test]
    fn accepts_a_minimal_board() {
        assert_eq!(validate(&minimal()), Ok(0));
    }

    #[test]
    fn rejects_anything_that_is_not_a_board() {
        for value in [json!(null), json!(3), json!("board"), json!([])] {
            assert_eq!(validate(&value), Err(BoardError::NotAnObject));
        }
    }

    #[test]
    fn rejects_an_unknown_schema_version() {
        let mut board = minimal();
        board["schema"] = json!(2);
        assert_eq!(validate(&board), Err(BoardError::UnsupportedSchema));
    }

    #[test]
    fn rejects_a_board_without_tiers() {
        let mut board = minimal();
        board["tiers"] = json!([]);
        assert_eq!(validate(&board), Err(BoardError::NoTiers));
    }

    #[test]
    fn rejects_an_over_long_title() {
        let mut board = minimal();
        board["title"] = json!("x".repeat(limits::TITLE + 1));
        assert_eq!(validate(&board), Err(BoardError::TooLong));
    }

    #[test]
    fn counts_characters_rather_than_bytes() {
        let mut board = minimal();
        // 120 accented characters is 240 bytes but a legal title.
        board["title"] = json!("é".repeat(limits::TITLE));
        assert_eq!(validate(&board), Ok(0));
    }

    #[test]
    fn rejects_too_many_items() {
        let mut board = minimal();
        board["items"] = json!((0..=limits::ITEMS)
            .map(|i| json!({ "id": i.to_string(), "label": "x" }))
            .collect::<Vec<_>>());
        assert_eq!(validate(&board), Err(BoardError::TooManyItems));
    }

    #[test]
    fn rejects_an_image_that_is_not_inline_raster_data() {
        for hostile in [
            "javascript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD4=",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "https://example.com/tracker.gif",
            "data:image/png;base64,",
            "data:image/png;base64,<script>",
        ] {
            let mut board = minimal();
            board["items"] = json!([{ "id": "i1", "label": "x", "image": hostile }]);
            assert_eq!(
                validate(&board),
                Err(BoardError::BadImage),
                "should have refused {hostile}"
            );
        }
    }

    #[test]
    fn accepts_a_real_inline_image() {
        let mut board = minimal();
        board["items"] = json!([{
            "id": "i1",
            "label": "x",
            "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        }]);
        assert_eq!(validate(&board), Ok(1));
    }

    #[test]
    fn rejects_an_oversized_image() {
        let mut board = minimal();
        let payload = "A".repeat(limits::IMAGE + 1);
        board["items"] = json!([{
            "id": "i1",
            "label": "x",
            "image": format!("data:image/png;base64,{payload}")
        }]);
        assert_eq!(validate(&board), Err(BoardError::TooLong));
    }

    #[test]
    fn rejects_wrongly_typed_fields() {
        let mut board = minimal();
        board["title"] = json!(42);
        assert_eq!(validate(&board), Err(BoardError::BadShape));

        let mut board = minimal();
        board["tiers"] = json!("S");
        assert_eq!(validate(&board), Err(BoardError::BadShape));
    }
}
