//! The HTTP stack: every layer wrapped around the routes.
//!
//! This lives here rather than in `main` so the tests attack the real server.
//! A pentest that exercised a bare router would be testing a friendlier service
//! than the one that gets deployed — CORS, the body limit, the rate limiter and
//! the security headers are all part of what is being asserted.

use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    http::{header, HeaderValue, Method, StatusCode},
    Router,
};
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::{
    cors::CorsLayer, limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer, trace::TraceLayer,
};

use crate::{board::limits, routes, AppState};

/// Sits just above the largest board we accept, so an oversized request dies in
/// the framework before a byte of it is parsed. The margin covers the JSON
/// envelope around the document — title, flags — and nothing more.
pub const MAX_BODY_BYTES: usize = limits::DOCUMENT_BYTES + 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Builds the full application: routes plus every layer that guards them.
///
/// Layer order is deliberate. `.layer()` wraps outwards, so the last call is the
/// outermost: a request meets the response headers, then the timeout, then the
/// body limit, then the rate limiter, then CORS. Cheap rejections happen first,
/// and nothing expensive runs for a request that was never going to be served.
pub fn app(state: AppState) -> Result<Router> {
    let config = Arc::clone(&state.config);

    // An explicit allow-list, and credentials are only ever sent to it. A
    // wildcard here would let any page on the internet act as a signed-in user.
    let origins = config
        .allowed_origins
        .iter()
        .map(|origin| HeaderValue::from_str(origin).context("invalid allowed origin"))
        .collect::<Result<Vec<_>>>()?;

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);

    // Per-client token bucket: a burst is fine, a flood is not.
    //
    // `SmartIpKeyExtractor` reads `X-Forwarded-For` before falling back to the
    // socket address. Behind a reverse proxy the socket address is the proxy's,
    // so without this every visitor would share one bucket and a single abusive
    // client would rate-limit the whole site. The header is attacker-controlled,
    // which is why the deployment notes are emphatic that the proxy must
    // *overwrite* it rather than append to it.
    let governor = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(config.rate_limit_per_second)
            .burst_size(config.rate_limit_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .context("invalid rate limit configuration")?,
    );

    Ok(routes::router(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(GovernorLayer { config: governor })
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        // Defence in depth for the JSON API: nothing here should ever be framed,
        // sniffed as another type, or sent with a referrer.
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        // An API response is nobody's to keep. Without this a shared proxy is
        // free to cache `/api/me` and hand one person's profile to the next
        // caller, and a browser is free to leave a board in its disk cache.
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        // A JSON API has no reason to be reachable from a document context, and
        // a restrictive policy costs nothing on responses nobody renders.
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
        )))
}
