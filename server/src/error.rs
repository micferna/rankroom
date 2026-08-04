use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Everything the API can refuse to do.
///
/// Variants map to a status *and* a stable machine-readable code, so the client
/// can react without parsing prose. Internal failures deliberately carry no
/// detail across the wire — the detail goes to the log, where it belongs.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("authentication required")]
    Unauthorised,

    #[error("not allowed")]
    Forbidden,

    #[error("not found")]
    NotFound,

    #[error("{0}")]
    BadRequest(&'static str),

    #[error("too many boards")]
    QuotaExceeded,

    #[error("sign-in is not configured on this server")]
    SignInUnavailable,

    #[error(transparent)]
    Database(#[from] sqlx::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct Body {
    error: &'static str,
    message: String,
}

impl ApiError {
    fn parts(&self) -> (StatusCode, &'static str) {
        match self {
            Self::Unauthorised => (StatusCode::UNAUTHORIZED, "unauthorised"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::QuotaExceeded => (StatusCode::CONFLICT, "quota_exceeded"),
            Self::SignInUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "sign_in_unavailable"),
            Self::Database(_) | Self::Other(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.parts();

        let message = match &self {
            // Never leak a database or internal error to a caller: it is the
            // cheapest source of schema and version intelligence there is.
            Self::Database(error) => {
                tracing::error!(?error, "database error");
                "Something went wrong on the server.".to_string()
            }
            Self::Other(error) => {
                tracing::error!(?error, "internal error");
                "Something went wrong on the server.".to_string()
            }
            other => other.to_string(),
        };

        (
            status,
            Json(Body {
                error: code,
                message,
            }),
        )
            .into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
