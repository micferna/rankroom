use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Live overlay fan-out.
///
/// An OBS Browser Source cannot hold a login — it is a URL in a text field. So
/// the overlay authenticates with its own key instead: unguessable, scoped to
/// one streamer, and rotatable without touching their session. Rotating it
/// disconnects every overlay instantly, which is the revocation story.
///
/// The channel is in memory on purpose. A dropped connection reconnects and asks
/// for the current board again; there is nothing worth persisting in a feed
/// whose entire content is "here is the board now".
#[derive(Clone, Default)]
pub struct OverlayHub {
    channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
}

/// Enough for a viewer that stalls briefly without dropping the connection.
const CHANNEL_CAPACITY: usize = 16;

impl OverlayHub {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Subscribes to a streamer's feed, creating the channel on first listener.
    ///
    /// # Panics
    ///
    /// If the internal lock was poisoned by a thread that panicked while
    /// holding it — a state the process cannot usefully continue from.
    #[must_use]
    pub fn subscribe(&self, user_id: Uuid) -> broadcast::Receiver<String> {
        let mut channels = self.channels.lock().expect("overlay hub poisoned");
        channels
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }

    /// Publishes to whoever is listening. Nobody listening is not an error —
    /// a streamer who has not opened their overlay is the normal case.
    ///
    /// # Panics
    ///
    /// See [`OverlayHub::subscribe`].
    pub fn publish(&self, user_id: Uuid, payload: String) {
        let channels = self.channels.lock().expect("overlay hub poisoned");
        if let Some(sender) = channels.get(&user_id) {
            let _ = sender.send(payload);
        }
    }

    /// Drops channels nobody is listening to, so a long-running server does not
    /// accumulate one entry per streamer who ever connected.
    ///
    /// # Panics
    ///
    /// See [`OverlayHub::subscribe`].
    pub fn sweep(&self) {
        let mut channels = self.channels.lock().expect("overlay hub poisoned");
        channels.retain(|_, sender| sender.receiver_count() > 0);
    }

    /// # Panics
    ///
    /// See [`OverlayHub::subscribe`].
    #[must_use]
    pub fn active_channels(&self) -> usize {
        self.channels.lock().expect("overlay hub poisoned").len()
    }
}

fn hash(key: &str) -> Vec<u8> {
    Sha256::digest(key.as_bytes()).to_vec()
}

/// Issues a fresh overlay key, replacing any previous one.
pub async fn rotate_key(pool: &PgPool, user_id: Uuid) -> sqlx::Result<String> {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let key = URL_SAFE_NO_PAD.encode(bytes);

    sqlx::query(
        r"
        insert into overlay_keys (user_id, key_hash)
        values ($1, $2)
        on conflict (user_id) do update set key_hash = excluded.key_hash, created_at = now()
        ",
    )
    .bind(user_id)
    .bind(hash(&key))
    .execute(pool)
    .await?;

    Ok(key)
}

/// Resolves an overlay key to the streamer it belongs to.
pub async fn owner_of_key(pool: &PgPool, key: &str) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar::<_, Uuid>("select user_id from overlay_keys where key_hash = $1")
        .bind(hash(key))
        .fetch_optional(pool)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_publish_reaches_every_listener() {
        let hub = OverlayHub::new();
        let user = Uuid::new_v4();

        let mut first = hub.subscribe(user);
        let mut second = hub.subscribe(user);
        hub.publish(user, "hello".to_string());

        assert_eq!(first.try_recv().unwrap(), "hello");
        assert_eq!(second.try_recv().unwrap(), "hello");
    }

    #[test]
    fn streamers_do_not_receive_each_other() {
        let hub = OverlayHub::new();
        let (alice, bob) = (Uuid::new_v4(), Uuid::new_v4());

        let mut alices = hub.subscribe(alice);
        let mut bobs = hub.subscribe(bob);
        hub.publish(alice, "alice board".to_string());

        assert_eq!(alices.try_recv().unwrap(), "alice board");
        assert!(bobs.try_recv().is_err(), "bob must not see alice's board");
    }

    #[test]
    fn publishing_with_nobody_listening_is_fine() {
        let hub = OverlayHub::new();
        hub.publish(Uuid::new_v4(), "into the void".to_string());
    }

    #[test]
    fn sweeping_drops_abandoned_channels() {
        let hub = OverlayHub::new();
        let user = Uuid::new_v4();

        let listener = hub.subscribe(user);
        assert_eq!(hub.active_channels(), 1);

        hub.sweep();
        assert_eq!(
            hub.active_channels(),
            1,
            "a live listener keeps its channel"
        );

        drop(listener);
        hub.sweep();
        assert_eq!(hub.active_channels(), 0);
    }
}
