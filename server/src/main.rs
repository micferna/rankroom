use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result};
use axum::http::{header, HeaderValue, Method};
use rankroom_server::{config::Config, overlay::OverlayHub, routes, AppState};
use sqlx::postgres::PgPoolOptions;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{
    cors::CorsLayer, limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer, trace::TraceLayer,
};

/// Bounded above the largest board we accept, so an oversized request is
/// refused by the framework before any of it is parsed.
const MAX_BODY_BYTES: usize = 100 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// How often expired sessions and stale overlay channels are cleared out.
const HOUSEKEEPING_INTERVAL: Duration = Duration::from_secs(15 * 60);

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    // The container image is distroless: no shell, no curl. So the binary
    // probes itself, and Compose calls it with this flag.
    if std::env::args().any(|arg| arg == "--health-check") {
        return health_check().await;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rankroom_server=info,tower_http=warn".into()),
        )
        .init();

    let config = Arc::new(Config::from_env().context("invalid configuration")?);

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .context("could not reach the database")?;

    rankroom_server::migrate(&pool)
        .await
        .context("migrations failed")?;

    if config.twitch.is_none() {
        tracing::warn!("TWITCH_CLIENT_ID is not set: public boards work, but nobody can sign in");
    }

    let state = AppState {
        pool: pool.clone(),
        config: Arc::clone(&config),
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("rankroom-server")
            .build()
            .context("could not build the HTTP client")?,
        overlay: OverlayHub::new(),
    };

    housekeeping(pool.clone(), state.overlay.clone());

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

    // Per-IP token bucket: a burst is fine, a flood is not.
    let governor = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(config.rate_limit_per_second)
            .burst_size(config.rate_limit_burst)
            .finish()
            .context("invalid rate limit configuration")?,
    );

    let app = routes::router(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(GovernorLayer { config: governor })
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
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
        ));

    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("could not bind {}", config.bind))?;

    tracing::info!(address = %config.bind, "rankroom-server listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await
    .context("server error")?;

    Ok(())
}

/// Asks the running server whether it is well, for the container healthcheck.
async fn health_check() -> Result<()> {
    let bind = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let port = bind.rsplit(':').next().unwrap_or("8080");

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .await
        .context("the server is not answering")?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(anyhow::anyhow!(
            "health check returned {}",
            response.status()
        ))
    }
}

/// Periodically clears expired sessions and abandoned overlay channels.
fn housekeeping(pool: sqlx::PgPool, overlay: OverlayHub) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(HOUSEKEEPING_INTERVAL);
        loop {
            ticker.tick().await;
            overlay.sweep();

            match rankroom_server::auth::purge_expired(&pool).await {
                Ok(0) => {}
                Ok(removed) => tracing::info!(removed, "purged expired rows"),
                Err(error) => tracing::warn!(?error, "housekeeping failed"),
            }
        }
    });
}

async fn shutdown() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tracing::info!("shutting down");
}
