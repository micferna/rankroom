# Security assessment — rankroom-server

**Date:** 5 August 2026 · **Version:** `1.0.0` · **Method:** source review, then
adversarial black-box testing over HTTP against the deployed stack, plus
property testing of the input validator and a supply-chain review.

> **This is a self-assessment, not an independent audit.** The same author wrote
> the server and the attacks against it, which shares their blind spots — a test
> suite cannot find a threat its author did not imagine. Nothing here should be
> presented as third-party assurance. If this server holds other people's
> accounts, commission a real audit; this document is written so an auditor has
> somewhere to start rather than a blank page.

---

## Summary

Nine issues were found. Four were exploitable defects, all of them now fixed and
each pinned by the test that caught it. Five were hardening gaps closed in the
same pass.

| #   | Finding                                                   | Severity          | Status               |
| --- | --------------------------------------------------------- | ----------------- | -------------------- |
| 1   | Login CSRF: OAuth handshake not bound to a browser        | **High**          | Fixed                |
| 2   | Board quota bypassed by concurrent requests (TOCTOU)      | **Medium**        | Fixed                |
| 3   | Session cookie shadowable from a sibling subdomain        | **Medium**        | Fixed                |
| 4   | No storage quota: an account could fill the disk          | **Medium**        | Fixed                |
| 5   | Rate limiter keyed on the proxy, throttling everyone      | **Medium**        | Fixed                |
| 6   | Authenticated responses were cacheable                    | **Low**           | Fixed                |
| 7   | NUL byte in a URL returned 500 instead of 404             | **Low**           | Fixed                |
| 8   | Request body limit three times larger than any real board | **Low**           | Fixed                |
| 9   | Overlay key travels in a query string                     | **Informational** | Accepted, documented |

The controls that held on the first run are listed under
[What did not break](#what-did-not-break); they matter as much as the failures.

---

## Findings

### 1. Login CSRF — the OAuth handshake was not bound to a browser

**Severity: High.** Account takeover of everything the victim creates after the
attack, without any interaction beyond following a link.

The sign-in flow stored a random `state` server-side and accepted any callback
that presented it. `state` is the standard CSRF defence for OAuth, but it only
proves _this server started some handshake_ — not _this browser started it_.

The attack:

1. The attacker visits `/api/auth/twitch/start` and completes sign-in against
   their own Twitch account, stopping at the redirect back rather than following
   it. They now hold a valid `code` and `state`.
2. They send the victim that callback URL.
3. The victim's browser loads it. The server exchanges the code, and sets a
   session cookie — for the **attacker's** account.
4. The victim, seeing a signed-in app, carries on. Every board they build lands
   in the attacker's account, where the attacker can read it, publish it, or
   delete it.

The victim is never shown anyone else's name in a place they would question, and
nothing about the app looks wrong. This is a known OAuth failure mode, and
`state` alone does not address it: `state` travels through URLs, referrers,
proxy logs and browser history, so possession of it proves nothing about who is
holding it.

**Fix.** A handshake now carries two secrets. `state` goes out through Twitch as
before; a second random `binding` is set as a short-lived `HttpOnly` cookie and
never leaves the browser. Its hash is stored beside the handshake, and the
callback requires both:

```sql
delete from oauth_states
where state_hash = $1 and binding_hash = $2 and expires_at > now()
returning pkce_verifier
```

Matching in the same `where` matters twice over. The obvious half is that a
caller without the cookie cannot complete the sign-in. The subtler half is that
they cannot _invalidate_ it either — a check that deleted the row first and
compared afterwards would hand an attacker a denial-of-service against anyone
trying to sign in. The check runs before the code is exchanged, so a forged
callback costs one indexed delete and reaches Twitch never.

`SameSite=Lax` is required here and `Strict` would not work: the callback is a
top-level cross-site navigation from Twitch, and `Strict` drops the cookie on
exactly that request.

Pinned by `the_oauth_handshake_is_bound_to_the_browser_that_started_it` and
`an_oauth_state_is_useless_without_its_browser_binding`, which also asserts that
a failed attack leaves the legitimate handshake usable.

---

### 2. Board quota bypassed by concurrent requests

**Severity: Medium.** Unbounded resource consumption by any signed-in user.

Creating a board counted first and inserted second:

```rust
if db::count_boards(&pool, user.id).await? >= db::BOARD_QUOTA { … }
let row = db::insert_board(…).await?;
```

Two statements, and a window between them. Twenty concurrent requests all read
the same count, all find room, and all insert.

Measured, not assumed — the first run of
`the_board_quota_holds_under_concurrent_requests` fired twenty requests at the
last free slot:

```
the quota let 20 requests through, not 1
```

Every one succeeded. The limit was decorative under any concurrency at all, and
an attacker does not need a race condition tool for this — twenty parallel
`fetch` calls from a console will do.

**Fix.** Counting and inserting now happen inside one transaction that first
takes a row lock on the owner:

```rust
let mut transaction = pool.begin().await?;
sqlx::query("select 1 from users where id = $1 for update")…
```

Board creation for one account is serialised; nothing else in the system
contends for that lock, so the cost is confined to the one operation that needs
it. A conditional `insert … select … where (select count(*)) < quota` was
considered and rejected: under `READ COMMITTED` the subquery is still evaluated
per statement, which narrows the window rather than closing it.

---

### 3. Session cookie shadowable from a sibling subdomain

**Severity: Medium.** Session fixation, conditional on controlling any host
under the same registrable domain.

The cookie was named `rankroom_session` with no prefix, and the server reads the
first cookie of that name. A cookie set for `.runship.fr` by any subdomain —
`old-project.runship.fr`, a forgotten staging host, anything taken over — is
sent alongside the real one, and ordering between them is not something the
server can rely on.

The exposure scales with how many hosts share the domain, which for a
self-hoster is usually "more than they remember".

**Fix.** The cookie is now `__Host-rankroom_session`. The prefix is enforced by
the browser, not by us: a `__Host-` cookie may carry no `Domain` attribute, must
be `Secure`, and must have `Path=/`. A sibling subdomain therefore cannot set
one at all. The handshake cookie from finding 1 carries the same prefix.

Browsers reject a `__Host-` cookie that is not `Secure`, so local plain-HTTP
development falls back to the bare name under `INSECURE_COOKIES`, which is
already documented as development-only.

Pinned by `the_session_cookie_cannot_be_read_or_shadowed`, which runs against a
target configured the way a real deployment is.

---

### 4. No storage quota

**Severity: Medium.** Disk exhaustion by a signed-in user acting within every
other limit.

The board count was capped at 200 and a document at 96 MB, so one account could
legitimately store roughly 19 GB. Nothing in the code objected, because nothing
was counting bytes. On a self-hosted server this is a full disk, which takes
Postgres down with it.

**Fix.** A per-account byte quota, checked in the same transaction as finding 2
and enforced with `pg_column_size` over the account's stored documents.
Configurable via `STORAGE_QUOTA_MB`, default 512. Exceeding it returns a
distinct `storage_exceeded` code so a client can say something useful rather
than "conflict".

---

### 5. Rate limiter keyed on the reverse proxy

**Severity: Medium.** Denial of service against all users by any one of them.

The limiter used its default key extractor: the peer socket address. Behind a
reverse proxy — the documented, recommended deployment — that address is the
proxy's for every request. All visitors therefore shared one bucket, and one
abusive client would rate-limit the entire site while barely inconveniencing
themselves.

**Fix.** `SmartIpKeyExtractor`, which reads the forwarded address and falls back
to the socket. That header is attacker-controlled, so the fix is only real if
the proxy overwrites it — the README and `.env.example` now say so with the
exact nginx directive, because `$proxy_add_x_forwarded_for` (the value most
snippets on the internet use) _appends_ and would let a caller mint a fresh
bucket per request by sending their own header.

Pinned by `one_clients_flood_does_not_lock_everyone_else_out`.

---

### 6. Authenticated responses were cacheable

**Severity: Low.** Cross-user disclosure through a shared cache.

No `Cache-Control` was set on any response. `/api/me` and private board contents
were therefore heuristically cacheable: a shared proxy is free to store one
person's profile and serve it to the next caller, and a browser is free to leave
a private board in its on-disk cache.

**Fix.** `Cache-Control: no-store` on every response, plus
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` — a JSON
API has no reason to be reachable from a document context.

Pinned by `every_response_carries_its_security_headers`.

---

### 7. NUL byte in a URL returned 500

**Severity: Low.** Error-handling defect; minor information disclosure.

`GET /api/u/%00` reached Postgres, which rejects NUL in `text`, and surfaced as
a 500. The body was the generic internal-error message, so nothing leaked
directly, but a 500 on attacker-controlled input is a signal that input reaches
further than intended — and it is exactly the kind of endpoint an attacker
probes to map the stack.

**Fix.** Public identifiers are shape-checked before any query. A login must
match what the database constrains it to, a slug likewise. Anything else is
_not found_ without a round trip, which also removes a free database query from
an unauthenticated endpoint.

Found by `injection_payloads_in_paths_do_no_harm`, which sends ten hostile
payloads through every public path parameter.

---

### 8. Request body limit far larger than any real board

**Severity: Low.** Memory amplification.

The body limit was 100 MB against a document limit of 96 MB — and the two were
inconsistent, since the client's own per-tile limits permit a 112 MB board that
the server would then refuse. Every in-flight request could pin ~100 MB.

**Fix.** The document limit is 32 MB and the body limit derives from it rather
than being a separate constant that can drift. 32 MB still holds four hundred
tiles at 80 KB each; the images the client actually produces are 320px WebP at
10–30 KB, so the ceiling was describing nothing anyone builds. Worst-case memory
per request drops by roughly 3.5×.

The matching browser-side check lands when the front end starts uploading. Until
then the server is the only place it is enforced, which is the right place for
it to be.

---

### 9. Overlay key travels in a query string

**Severity: Informational.** Accepted risk, documented.

`GET /api/overlay/live?key=…` authenticates with a bearer credential in a URL.
Query strings reach proxy access logs, browser history and `Referer` headers.

This is not fixable without giving up the feature: an OBS Browser Source is a
URL in a text field. It cannot send a header, cannot hold a session, and cannot
complete an OAuth flow. The key is therefore scoped as narrowly as the feature
allows — it grants watching one streamer's board change, nothing else — it is
stored hashed, and rotating it disconnects every overlay instantly.

Mitigations in place: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
and a default log filter that does not record request URIs. Operators who raise
the log level, or whose proxy logs query strings, will capture live keys.

**One consequence deserves stating plainly:** the overlay feed carries board
updates including private boards. An overlay key handed to an editor or a
moderator lets them watch private boards change. Treat it as a credential.

---

## What did not break

Recorded because a report that only lists failures gives no sense of the floor.
These held on the first run, before any fix in this document:

- **Authorisation.** No route served, modified or deleted another account's
  board. Ownership sits in the `where` clause, so there is no window between
  the check and the write.
- **The 403/404 distinction.** Another user's board and a board that does not
  exist return byte-identical responses. Asserted by comparing both, not by
  reading the code.
- **Injection.** Ten SQL, traversal and CRLF payloads through every path
  parameter changed nothing; the schema was intact afterwards. Every query is
  parameterised and none are built by concatenation.
- **XSS through tile images.** Eleven hostile values — `javascript:`,
  `data:text/html`, SVG-with-script, case variants, leading whitespace, control
  characters — were all refused.
- **Session handling.** Forged, expired and revoked tokens were refused; logout
  is immediate; tokens exist in the database only as SHA-256.
- **Nesting bombs.** A 50 000-deep document is refused by the parser, which caps
  recursion at 128. That is a dependency default rather than something this code
  does, so it is now asserted rather than assumed — see below.
- **Account deletion.** Removes every board and session by cascade, verified by
  querying for orphans afterwards.
- **CORS.** Five near-miss origins — including `null` and a suffix-match
  lookalike — were all refused, and the configured origin still works.
- **Secrets.** The Twitch client secret never appears in a redirect or a
  response.

### A test that was wrong

The first version of the fuzzer asserted that validation survives a document
nested ten thousand levels deep. It crashed with a stack overflow, which looked
like a serious finding.

It was not. The overflow is in `serde_json::Value`'s recursive drop, it happens
before this crate is involved, and **no request can produce such a value** —
the parser refuses anything past 128 levels, which was confirmed by measurement
rather than by reading the changelog. The test was constructing a threat that
does not exist.

It now asserts the real boundary: that the parser still refuses past its limit,
and that validation is safe for everything up to it. The dependency default is
load-bearing, so it is pinned — enabling `serde_json`'s `unbounded_depth`
feature, directly or transitively, would remove the protection silently, and
that test is what would notice.

---

## Coverage

**Fuzzing.** Two million generated documents across four seeds, with no panic
and no accepted hostile image. The generator is deliberately biased toward the
edges of the grammar; a first version produced a corpus the validator rejected
99.3% of the time, which would have passed every assertion while testing almost
nothing. The acceptance rate is now asserted, so the corpus cannot silently
degrade into that state again.

**Supply chain.** Actions and base images are pinned to immutable digests, with
CI asserting it. Images are scanned with Trivy on every push and weekly on a
schedule; the workflows themselves are audited with `zizmor`, the Dockerfile
with `hadolint`, and the repository history with Trivy's secret scanner. A
CycloneDX bill of materials is generated for both ecosystems and kept for
ninety days, so the next advisory is answerable in minutes rather than an
afternoon. `cargo deny` reports clean across advisories, licences, bans
and sources. `cargo audit` reports RUSTSEC-2023-0071 in `rsa`, reachable only
through `sqlx`'s MySQL driver, which is not enabled — `cargo deny`, which
resolves the real feature graph, does not see the crate at all. The ignore is
documented and **CI asserts the premise**, so if `rsa` ever becomes a genuine
dependency the build fails rather than the justification quietly going stale.
Three unused dependencies (`subtle`, `tower`, `http-body-util`) were removed;
unused crates are attack surface with no upside.

## Second pass — deployment and supply chain

A later review looked at what surrounds the code rather than the code itself:
how it is built, what it is built from, and what it is served by. Six more
issues, all fixed.

| #   | Finding                                               | Severity   | Status |
| --- | ----------------------------------------------------- | ---------- | ------ |
| 10  | No `.dockerignore`: `.env` would ship inside an image | **High**   | Fixed  |
| 11  | Every CI action pinned to a mutable tag               | **High**   | Fixed  |
| 12  | Base images pinned to mutable tags                    | **Medium** | Fixed  |
| 13  | Static-file server carried ten known vulnerabilities  | **Medium** | Fixed  |
| 14  | npm install scripts ran during the image build        | **Medium** | Fixed  |
| 15  | An unknown `/api/*` path answered with the app        | **Low**    | Fixed  |

### 10. No `.dockerignore`

The Dockerfile used `COPY . .` and no `.dockerignore` existed. A `.env` sitting
in the working directory — which is exactly where the deployment instructions
put it, holding the Postgres password and the Twitch client secret — would have
been copied into an image layer.

Layers are permanent. Deleting the file in a later step does not remove it; it
hides it, and anyone who pulls the image can read it back out.

**Fix.** A `.dockerignore` that excludes secrets, `.git` (which carries every
credential ever committed, including ones since reverted), and build output. The
build context dropped to 2.4 MB, and the Dockerfile now names what it copies
instead of taking everything.

### 11. CI actions pinned to mutable tags

All thirteen actions were referenced by tag — `actions/checkout@v7` — and one,
`dtolnay/rust-toolchain@stable`, by _branch_.

A tag is a pointer its owner can move. This is not theoretical: in March 2025
the `tj-actions/changed-files` tags were retargeted at a malicious commit, and
every workflow that trusted them leaked its secrets into build logs. A branch is
worse still — no retargeting required.

**Fix.** Every action pinned to a 40-character commit SHA with the version in a
trailing comment, so Dependabot can still see and bump it. A CI job asserts the
property holds, because a pin nothing enforces is a pin that will not survive
its first hurried pull request.

### 12. Base images pinned to mutable tags

`FROM node:24-alpine` is not a fixed input either. Now pinned by digest, with the
same CI assertion.

### 13. The static-file server was the largest source of vulnerabilities

The first version of this stack served the front end with Caddy. Scanned, that
image carried **ten known vulnerabilities**: five in Alpine packages (`curl`,
`c-ares` — neither of which a static file server needs) and five in the Go
binary itself, including a `net/http` MIME parsing denial of service and a
symlink-following bug in `os.Root` that a file server plausibly reaches.

The API image, distroless, had **zero**.

**Fix.** Deleted the container. The Rust binary serves the built front end
itself, and the whole application is one distroless image: 49 MB, non-root,
read-only root filesystem, and no known vulnerabilities.

That also made "same origin" structural rather than configured. The app and the
API answer on one host because they are one process — not because a proxy was
set up correctly — which is what keeps the session cookie `SameSite=Lax` and
keeps cross-site request forgery out of the threat model. The alternative, a
front end on one host and an API on another, forces `SameSite=None` and puts
that surface back.

### 14. npm install scripts ran during the build

`npm ci` runs each dependency's install scripts, which is arbitrary code
execution on the build machine and the mechanism behind most published npm
compromises.

**Fix.** `npm ci --ignore-scripts`, after verifying the build works without
them. Nothing this project depends on needs one.

### 15. An unknown `/api/*` path answered with the app

Once the server served static files, its fallback caught unmatched API paths:
`GET /api/nope` returned the HTML page with a `200`. A client parses that as
success until it does not.

**Fix.** Explicit routes for `/api`, `/api/`, and `/api/{*rest}` returning a
JSON 404. Three, because a wildcard needs at least one segment — `/api/` alone
was falling through, which the test caught after the first two were added.

### What held

Path traversal against the new file server was tested with eight encodings —
`..`, percent-encoded, doubled, mixed with valid prefixes — and none escaped the
served directory. Every attempt returned the app, which is correct: the app
routes on the URL fragment, so any unknown path is the app itself. The test
asserts on the _body_, not the status, because a `200` here proves nothing on
its own.

---

## Limits of this assessment

Stated plainly, because the gaps matter more than the coverage:

- **Not independent.** One author wrote both the server and the attacks. Shared
  blind spots are not detectable from inside.
- **No live infrastructure was tested.** Everything ran against a local
  instance. TLS configuration, reverse proxy behaviour, database hardening,
  network exposure, secret handling at rest and backup security are all
  deployment concerns and none of them were assessed.
- **No adversarial cryptanalysis.** The primitives are standard library choices
  used in standard ways; nobody attacked them.
- **No traffic analysis or timing work.** Session lookup is an indexed hash
  comparison, which is not obviously a timing oracle, but this was reasoned
  about rather than measured.
- **Twitch is trusted.** If Twitch's identity API returns the wrong profile for
  a token, this server believes it. That is inherent to delegated identity.
- **Availability is bounded, not guaranteed.** Rate limiting and quotas raise
  the cost of abuse. They do not stop a distributed flood; that belongs in front
  of the application.

## Reproducing this

```bash
export TEST_DATABASE_URL=postgres://rankroom:dev@127.0.0.1:5432/rankroom

cargo test --test pentest              # the 24 attacks
cargo test --test authorisation        # 15 data-layer authorisation tests
FUZZ_ITERATIONS=2000000 cargo test --release --test fuzz_validation
cargo deny check && cargo audit
```

All of it runs on every push. Each test in `pentest.rs` is named for the attack
it performs, so a red run names the guarantee that broke.
