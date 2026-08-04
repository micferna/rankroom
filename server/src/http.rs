//! The HTTP stack: every layer wrapped around the routes, and the app itself.
//!
//! This lives here rather than in `main` so the tests attack the real server.
//! A pentest that exercised a bare router would be testing a friendlier service
//! than the one that gets deployed — CORS, the body limit, the rate limiter and
//! the security headers are all part of what is being asserted.
//!
//! When `STATIC_DIR` is set, this also serves the built front end. That is a
//! security decision before it is a convenience one: the app and the API answer
//! on the same origin, so a request between them is same-origin by
//! construction. The session cookie keeps `SameSite=Lax`, there is no CORS to
//! misconfigure, and no cross-site request forgery surface to defend. Splitting
//! them across two hosts would force `SameSite=None` and put that surface back.

use std::{path::Path, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::{
    http::{header, HeaderValue, Method, StatusCode},
    Router,
};
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::{
    cors::CorsLayer,
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

use crate::{board::limits, routes, AppState};

/// Sits just above the largest board we accept, so an oversized request dies in
/// the framework before a byte of it is parsed. The margin covers the JSON
/// envelope around the document — title, flags — and nothing more.
pub const MAX_BODY_BYTES: usize = limits::DOCUMENT_BYTES + 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The policy for the API: it is data, and nothing should ever render it.
const API_CSP: &str = "default-src 'none'; frame-ancestors 'none'";

/// The policy for the app.
///
/// Written so that an injected script is inert rather than on the assumption
/// that none can arrive — the page renders board content, including tile images
/// somebody else supplied. `data:` and `blob:` are needed for exactly that:
/// tiles are inline images, and the export renderer draws to a canvas.
/// `connect-src` allows Twitch's chat socket, which is the only third party the
/// app ever talks to.
const APP_CSP: &str = "default-src 'self'; \
     img-src 'self' data: blob:; \
     media-src 'self' blob:; \
     style-src 'self' 'unsafe-inline'; \
     script-src 'self'; \
     connect-src 'self' wss://irc-ws.chat.twitch.tv; \
     font-src 'self'; \
     worker-src 'self'; \
     object-src 'none'; \
     base-uri 'none'; \
     form-action 'none'; \
     frame-ancestors 'none'";

/// Builds the full application: routes, static files, and every layer that
/// guards them.
///
/// Layer order is deliberate. `.layer()` wraps outwards, so the last call is the
/// outermost: a request meets the shared security headers, then the timeout,
/// then the body limit, then the rate limiter, then CORS. Cheap rejections
/// happen first, and nothing expensive runs for a request that was never going
/// to be served.
pub fn app(state: AppState) -> Result<Router> {
    let config = Arc::clone(&state.config);

    // An explicit allow-list, and credentials are only ever sent to it. A
    // wildcard here would let any page on the internet act as a signed-in user.
    //
    // With the app served from this same origin the browser never needs any of
    // this, but a deployment that splits them still can, and the allow-list is
    // what keeps that from being wide open.
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
    //
    // `period` rather than `per_second`, which does not mean what its name
    // suggests: it sets the *interval between replenishments*, so passing 10
    // yields one request every ten seconds — a hundred times stricter than the
    // ten-per-second the setting advertises. That was the configuration until a
    // browser hitting the real stack ran into 429s and nothing else explained
    // them. The tests could not have caught it: a limiter that is too strict
    // still rate-limits a flood.
    let replenish = Duration::from_nanos(1_000_000_000 / config.rate_limit_per_second.max(1));

    let governor = Arc::new(
        GovernorConfigBuilder::default()
            .period(replenish)
            .burst_size(config.rate_limit_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .context("invalid rate limit configuration")?,
    );

    // An API response is nobody's to keep. Without this a shared cache is free
    // to hold `/api/me` and hand one person's profile to the next caller, and a
    // browser is free to leave a private board in its on-disk cache.
    let api = routes::router(state)
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(API_CSP),
        ));

    let router = match config.static_dir.as_deref() {
        Some(dir) => api.fallback_service(static_files(dir)),
        None => api,
    };

    Ok(router
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(GovernorLayer { config: governor })
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        // Defence in depth for everything served here: nothing should be framed,
        // sniffed as another type, or sent with a referrer. The referrer policy
        // matters more than it looks — the overlay key travels in a query
        // string, and a referrer would carry it to whatever the page links to.
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
        // Nothing here needs a camera, a microphone or a location.
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
        )))
}

/// Serves the built front end.
///
/// Two caching rules, because they are opposites. Vite writes hashed filenames
/// under `/assets`, so those bytes never change and can be held for a year.
/// `index.html` names them, so it must never be held at all — cache it and a
/// deploy stays invisible until every visitor clears their browser.
///
/// The app routes on the URL fragment, which never reaches a server, so any
/// path that is not a file is the app itself.
fn static_files(dir: &Path) -> Router {
    let assets = Router::new()
        .fallback_service(
            ServeDir::new(dir.join("assets"))
                .precompressed_gzip()
                .precompressed_br(),
        )
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));

    let index = ServeFile::new(dir.join("index.html"));
    let rest = Router::new()
        .fallback_service(
            ServeDir::new(dir)
                .precompressed_gzip()
                .precompressed_br()
                .fallback(index),
        )
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));

    Router::new()
        .nest_service("/assets", assets)
        .fallback_service(rest)
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(APP_CSP),
        ))
}
