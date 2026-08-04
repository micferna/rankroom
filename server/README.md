# rankroom-server

The **optional** backend for [RankRoom](../README.md).

RankRoom works completely without it: boards live in your browser, share links
carry themselves, and Twitch chat is read anonymously. This server exists for
the three things a browser cannot do alone.

| What it adds            | Why it needs a server                                 |
| ----------------------- | ----------------------------------------------------- |
| **Sign in with Twitch** | An identity that survives a new device                |
| **Public boards**       | A page other people can open: `/#/u/<your-channel>`   |
| **A live OBS overlay**  | A Browser Source that follows your board in real time |

That last one is the reason this exists. Without a server, an OBS Browser Source
runs in OBS's own browser and cannot follow your window — the app ships a baked
link instead. With one, the overlay subscribes to a live feed and updates as you
rank.

## Run your own

You are meant to. There is no hosted instance you have to trust, and no account
system in the front end unless you point it at a server you control.

```bash
cp .env.example .env      # fill in DATABASE_URL, PUBLIC_URL, Twitch credentials
docker compose up -d
```

Already have Postgres? The default `compose.yaml` expects that. If not:

```bash
echo "$(openssl rand -base64 32)" > db_password.txt
docker compose -f compose.yaml -f compose.postgres.yaml up -d
```

Migrations run automatically at startup — there is no separate tool to install.

### Behind your reverse proxy

The container binds `127.0.0.1:8080`; your proxy terminates TLS and forwards to
it. With Caddy:

```caddy
api.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Traefik, nginx and friends work the same way. Two things matter:

- **Forward the real client IP** (`X-Forwarded-For`), or per-IP rate limiting
  sees only your proxy.
- **Do not strip cookies.** Sessions are `HttpOnly`, `Secure`, `SameSite=Lax`.

### Twitch

Create an app at <https://dev.twitch.tv/console/apps> and set its OAuth Redirect
URL to exactly `<PUBLIC_URL>/api/auth/twitch/callback`.

No scopes are requested. The server asks Twitch who you are and nothing else —
it cannot read your chat, change your stream, or post anywhere.

### Point the front end at it

Build the app with `VITE_API_URL` set:

```bash
VITE_API_URL=https://api.example.com npm run build
```

Leave it unset and the front end has no idea this server exists, which is the
default and stays fully functional.

## What it stores

| Table          | Contents                                                    |
| -------------- | ----------------------------------------------------------- |
| `users`        | Twitch id, login, display name, avatar URL                  |
| `sessions`     | A SHA-256 **hash** of each session token, never the token   |
| `boards`       | Your boards, as the same JSON the browser uses              |
| `overlay_keys` | A hash of each overlay key                                  |
| `oauth_states` | In-flight sign-ins, deleted on use, expiring in ten minutes |

No passwords, because there are none: identity comes from Twitch. No email
addresses. No analytics. `DELETE /api/me` removes the account and everything
attached to it, immediately and by cascade — there is no soft delete.

## Security

The rule the code is built around: **the client is not a security boundary.**
Everything a browser sends is re-validated here, every row access is checked
against the session that asked for it, and the database carries its own
constraints in case a handler ever forgets.

Concretely:

- **Board documents are re-validated server-side** against the same limits the
  browser applies — tier and item counts, field lengths, and the rule that a
  tile image must be inline raster data. A `javascript:` or `data:text/html`
  value is refused here even though the browser would also refuse it.
- **Ownership is part of the query**, not a check before it: `update … where id
= $1 and owner_id = $2`. There is no window between reading and writing, and a
  board that is not yours reads as _not found_ rather than _forbidden_, so the
  response does not confirm the id exists.
- **Session tokens are stored hashed.** A database leak yields no usable
  sessions.
- **OAuth uses PKCE**, and each handshake state is single-use — deleted and
  returned in one statement, so a replay cannot succeed.
- **CORS is an explicit allow-list** and credentials only ever go to it.
- **Rate limiting** per IP, body size limits, request timeouts, and
  `nosniff` / `DENY` / `no-referrer` response headers.
- `#![forbid(unsafe_code)]`, `clippy::pedantic` as an error, `cargo deny` in CI.

### What has and has not been audited

The test suite includes **fourteen authorisation tests against a real
Postgres** — each one describes something a hostile client would try: reading,
updating and deleting someone else's board, reusing an expired or revoked
session, replaying an OAuth handshake, and using a rotated overlay key.

This is **not** a penetration test, and nothing here should be read as one. No
third party has assessed this code. If you run it for anyone but yourself,
commission a real audit; the threat model above is written so an auditor has
somewhere to start.

### Reporting a problem

See [SECURITY.md](../SECURITY.md). Please report privately.

## Development

```bash
docker run -d --name rankroom-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=rankroom \
  -e POSTGRES_DB=rankroom -p 5432:5432 postgres:17-alpine

export DATABASE_URL=postgres://rankroom:dev@127.0.0.1:5432/rankroom
export TEST_DATABASE_URL=$DATABASE_URL

cargo run                                    # migrations run on startup
cargo test                                   # unit tests, plus authorisation tests
cargo clippy --all-targets -- -D warnings
cargo deny check
```

The authorisation tests skip themselves when `TEST_DATABASE_URL` is unset, so
`cargo test` works without Postgres — it just proves less.

## Licence

MIT, like the rest of RankRoom.
