use std::{env, net::SocketAddr, time::Duration};

use anyhow::{anyhow, Context, Result};

/// Everything the server needs to start, read once from the environment.
///
/// Reading configuration in one place — and failing loudly at startup rather
/// than at the first request — means a misconfigured deployment never reaches
/// the point of half-working.
#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    /// Origins allowed to call the API. Anything else is refused outright.
    pub allowed_origins: Vec<String>,
    /// Where the browser is sent back to after signing in.
    pub app_url: String,
    /// Public base URL of this API, used to build the OAuth redirect.
    pub public_url: String,
    pub twitch: Option<TwitchConfig>,
    pub session_ttl: Duration,
    /// Requests per second per IP before the governor starts refusing.
    pub rate_limit_per_second: u64,
    pub rate_limit_burst: u32,
    /// True when the server is reached over plain HTTP (local development).
    /// Cookies drop their `Secure` flag, and nothing else changes.
    pub insecure_cookies: bool,
}

#[derive(Debug, Clone)]
pub struct TwitchConfig {
    pub client_id: String,
    pub client_secret: String,
}

fn var(key: &str) -> Result<String> {
    env::var(key).with_context(|| format!("{key} is required"))
}

fn optional(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

fn parse<T: std::str::FromStr>(key: &str, fallback: T) -> Result<T> {
    match optional(key) {
        None => Ok(fallback),
        Some(raw) => raw
            .parse()
            .map_err(|_| anyhow!("{key} is not a valid value: {raw}")),
    }
}

impl Config {
    /// # Panics
    ///
    /// Never in practice: the only `expect` is on a literal default address.
    pub fn from_env() -> Result<Self> {
        let bind: SocketAddr = parse("BIND", "0.0.0.0:8080".parse().expect("valid default"))?;
        let database_url = var("DATABASE_URL")?;

        let app_url = optional("APP_URL")
            .unwrap_or_else(|| "https://micferna.github.io/rankroom/".to_string());
        let public_url = optional("PUBLIC_URL").unwrap_or_else(|| format!("http://{bind}"));

        // Defaults to the app itself, so a fresh deployment is not open to every origin.
        let allowed_origins = optional("ALLOWED_ORIGINS").map_or_else(
            || vec![origin_of(&app_url)],
            |raw| {
                raw.split(',')
                    .map(|origin| origin.trim().trim_end_matches('/').to_string())
                    .filter(|origin| !origin.is_empty())
                    .collect::<Vec<_>>()
            },
        );

        if allowed_origins.is_empty() {
            return Err(anyhow!("ALLOWED_ORIGINS resolved to nothing"));
        }

        // Twitch is optional: without it the server still serves public boards,
        // it just cannot sign anybody in.
        let twitch = match (
            optional("TWITCH_CLIENT_ID"),
            optional("TWITCH_CLIENT_SECRET"),
        ) {
            (Some(client_id), Some(client_secret)) => Some(TwitchConfig {
                client_id,
                client_secret,
            }),
            (None, None) => None,
            _ => {
                return Err(anyhow!(
                    "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set together"
                ))
            }
        };

        Ok(Self {
            bind,
            database_url,
            allowed_origins,
            app_url,
            public_url: public_url.trim_end_matches('/').to_string(),
            twitch,
            session_ttl: Duration::from_secs(60 * 60 * 24 * parse::<u64>("SESSION_TTL_DAYS", 30)?),
            rate_limit_per_second: parse("RATE_LIMIT_PER_SECOND", 10)?,
            rate_limit_burst: parse("RATE_LIMIT_BURST", 40)?,
            insecure_cookies: parse("INSECURE_COOKIES", false)?,
        })
    }

    #[must_use]
    pub fn redirect_uri(&self) -> String {
        format!("{}/api/auth/twitch/callback", self.public_url)
    }
}

/// `https://host/path` → `https://host`, which is what a CORS origin is.
fn origin_of(url: &str) -> String {
    let without_scheme = url
        .split_once("://")
        .map_or(("https", url), |(scheme, rest)| (scheme, rest));

    let host = without_scheme.1.split('/').next().unwrap_or_default();
    format!("{}://{}", without_scheme.0, host)
}

#[cfg(test)]
mod tests {
    use super::origin_of;

    #[test]
    fn strips_the_path_from_an_app_url() {
        assert_eq!(
            origin_of("https://micferna.github.io/rankroom/"),
            "https://micferna.github.io"
        );
        assert_eq!(origin_of("http://localhost:5173"), "http://localhost:5173");
        assert_eq!(origin_of("http://localhost:5173/"), "http://localhost:5173");
    }
}
