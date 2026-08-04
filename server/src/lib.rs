//! `RankRoom`'s optional backend.
//!
//! The app works entirely without this server. What it adds is the handful of
//! things a browser cannot do alone: an identity that survives a new device,
//! boards other people can look at, and an overlay OBS can follow live.
//!
//! One rule shapes every module here: **the client is not a security boundary**.
//! Everything arriving from a browser is re-validated, every row access is
//! checked against the session that asked for it, and the database carries its
//! own constraints in case a handler ever forgets.

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions, clippy::missing_errors_doc)]

pub mod auth;
pub mod board;
pub mod config;
pub mod db;
pub mod error;
pub mod http;
pub mod overlay;
pub mod routes;

use std::sync::Arc;

use sqlx::PgPool;

use crate::{config::Config, overlay::OverlayHub};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    pub overlay: OverlayHub,
}

/// Runs the embedded migrations. Self-hosters never run a separate tool.
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
