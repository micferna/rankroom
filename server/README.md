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

### The front end

The stack image serves it from this same origin, with `VITE_API_URL=/api` baked
in at build time — that is what keeps the session cookie `SameSite=Lax` and
cross-site request forgery out of the threat model.

To build the app separately, point it at the API's base URL **including the
prefix**:

```bash
VITE_API_URL=https://rankroom.example.com/api npm run build
```

Leave it unset and the front end has no idea this server exists: no account
panel, no sign-in, no live overlay, and every other feature exactly as it was.
That is the default, and it stays fully functional.

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
- **OAuth uses PKCE**, each handshake state is single-use — deleted and returned
  in one statement — and each handshake is **bound to the browser that started
  it** by a second secret held only in a cookie. Without that binding, anyone
  holding a `state` could finish someone else's sign-in.
- **Session cookies carry the `__Host-` prefix**, so a sibling subdomain cannot
  set a cookie of the same name and shadow the session.
- **CORS is an explicit allow-list** and credentials only ever go to it.
- **Quotas are enforced transactionally** — board count and total stored bytes,
  both behind a lock on the owner's row, so concurrent requests cannot race
  through them.
- **Rate limiting per client**, body size limits, request timeouts, and
  `nosniff` / `DENY` / `no-referrer` / `no-store` / `CSP` response headers.
- `#![forbid(unsafe_code)]`, `clippy::pedantic` as an error, `cargo deny` in CI.

> **Reverse proxy requirement.** Rate limiting keys on `X-Forwarded-For` when it
> is present, because behind a proxy every request otherwise shares one bucket
> and a single abusive client throttles everyone. Your proxy **must overwrite**
> that header, never append to it. In nginx that means
> `proxy_set_header X-Forwarded-For $remote_addr;` — _not_
> `$proxy_add_x_forwarded_for`, which keeps whatever the caller sent. Caddy and
> Traefik overwrite by default.

### What has and has not been audited

The suite is in three parts, and all of it runs on every push:

| Suite                      | What it does                                          |
| -------------------------- | ----------------------------------------------------- |
| `tests/authorisation.rs`   | 15 tests against a real Postgres, at the data layer   |
| `tests/pentest.rs`         | 28 attacks over real HTTP against the **whole** stack |
| `tests/fuzz_validation.rs` | 250 000 generated documents through the validator     |

`pentest.rs` boots the server exactly as it is deployed — CORS, rate limiter,
body limit, headers and all — and then attacks it: anonymous access to every
protected route, forged and expired and revoked sessions, reading and writing
and deleting another account's board, SQL injection and path traversal and CRLF
in every path parameter, `javascript:` and `data:text/html` in tile images,
nesting bombs, oversized bodies, CORS origins that should be refused, overlay
key guessing and replay-after-rotation, and twenty concurrent requests racing a
quota. **Each test is named for the attack it performs, so a failure reads as a
vulnerability report.**

Running it for the first time found four real defects, since fixed and each now
pinned by the test that caught it: login CSRF through an unbound OAuth
handshake, a quota that twenty concurrent requests drove straight through, a
session cookie a sibling subdomain could shadow, and a NUL byte in a URL that
became a 500. [`AUDIT.md`](AUDIT.md) is the full write-up.

This is **self-assessment, not an independent audit.** The same person wrote the
server and the attacks against it, and that shares its blind spots — a test
suite cannot find a threat its author did not imagine. No third party has
assessed this code. If you run it for anyone but yourself, commission a real
audit; `AUDIT.md` and the threat model above are written so an auditor has
somewhere to start.

## Backups

A `backup` container dumps the database on a schedule into `./backups`, and
**verifies every dump by reading it back** before keeping it. That check is the
point: a dump truncated by a full disk or a killed container is still a file of
roughly the right size in the right place, and it looks exactly like a good one
until the day it is needed. A dump that `pg_restore` cannot list is deleted
rather than left to be mistaken for a backup.

```bash
docker compose exec backup /scripts/backup.sh    # one now, outside the schedule
ls -lt backups/
```

Two settings, both in `.env`: `BACKUP_INTERVAL_SECONDS` (default daily) and
`BACKUP_KEEP_DAYS` (default 14). Pruning only runs _after_ a dump has been kept,
so a run of failures never erodes the history that is still good.

### Restoring

```bash
docker compose run --rm -e CONFIRM=yes backup \
  /scripts/restore.sh /backups/rankroom-20260805T000000Z.dump
docker compose restart app
```

It refuses without `CONFIRM=yes`, and refuses any archive it cannot read. The
restore runs in a single transaction: it lands whole or leaves the database as
it found it.

**Practise this.** A backup nobody has restored is a file, not a recovery plan,
and the first time you find out whether yours works should not be the day the
disk died. The drill takes two minutes: `docker compose down -v`, bring the
database back up, restore, check your boards are there.

### Two things the scripts cannot do for you

- **Copy them off this machine.** A backup on the same disk as the database
  covers a bad migration and nothing else — not a failed disk, not a lost
  server, not ransomware. Sync `./backups` somewhere else.
- **Protect them.** Those dumps contain every account and every board, in the
  clear. They deserve the same care as the database itself: restrictive
  permissions, and encryption if they leave the host.

### Reporting a problem

See [SECURITY.md](../SECURITY.md). Please report privately.

## Development

```bash
docker run -d --name rankroom-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=rankroom \
  -e POSTGRES_DB=rankroom -p 5432:5432 postgres:17-alpine

export DATABASE_URL=postgres://rankroom:dev@127.0.0.1:5432/rankroom
export TEST_DATABASE_URL=$DATABASE_URL

cargo run                                    # migrations run on startup
cargo test                                   # everything
cargo test --test pentest                    # just the attacks
cargo clippy --all-targets -- -D warnings
cargo deny check
```

The authorisation and pentest suites skip themselves when `TEST_DATABASE_URL` is
unset, so `cargo test` works without Postgres — it just proves less.

The fuzzer needs nothing and always runs. For a longer soak:

```bash
FUZZ_ITERATIONS=2000000 FUZZ_SEED=42 cargo test --release --test fuzz_validation
```

The seed is fixed by default so a failure is reproducible. Vary it deliberately;
do not wire a random seed into CI, or the suite starts failing on unrelated
pull requests.

## Licence

MIT, like the rest of RankRoom.
