# Architecture

RankRoom is a static single-page app. There is no server, no database and no account
system — every design decision below follows from that.

```
┌─ src/lib/ ───────────────────────────────────────────────┐
│  Pure domain logic. No React, no DOM in the hot paths.    │
│  board · duel · crowd · compare · schema · share · render │
└───────────────────┬───────────────────────────────────────┘
                    │ read by
┌───────────────────▼───────────────────────────────────────┐
│  src/store/       zustand. The only place state mutates.  │
└───────────────────┬───────────────────────────────────────┘
                    │ subscribed by
┌───────────────────▼───────────────────────────────────────┐
│  src/components/  primitives + the board                  │
│  src/features/    one folder per mode and per dialog      │
└───────────────────────────────────────────────────────────┘
```

The rule that keeps this honest: **components never reimplement domain logic**. If a
calculation matters — where a tile lands, how a ranking splits into tiers, what two boards
disagree about — it lives in `src/lib`, has tests, and runs without a DOM.

## The data model

```ts
interface Board {
  schema: 1
  tiers: Tier[] // ordered best to worst; each holds an ordered list of item ids
  bench: ItemId[] // everything not yet ranked
  items: Record<ItemId, Item>
}
```

Items are stored once in a flat map and referenced by id from exactly one _zone_ — a tier
or the bench. That invariant is what makes `moveItem` safe: it detaches from wherever the
item is before inserting, so an item cannot end up in two rows, and a corrupt import can
be repaired by rebuilding placement from scratch (`parseBoard` does exactly that).

Boards are immutable. Every operation returns a new board with structural sharing, and
returns the _same_ board when nothing changed — including when a tile is dropped exactly
where it already was. That identity check is load-bearing: it is what stops a no-op drag
from costing an undo step and polluting the replay.

## Undo, and why there is one write path

`boardStore` exposes a single private `commit(next, options)`. Undo history, redo
invalidation and the replay log are all updated there, together, so they cannot drift.

- **History** is an array of whole boards, capped at 60. Because boards share structure,
  a snapshot costs a handful of objects, not a deep clone of every image.
- **Coalescing** collapses consecutive edits of the same field within 700 ms into one undo
  step, so typing a title is one <kbd>⌘Z</kbd> rather than forty.
- **Redo** is abandoned the moment a new edit lands, as in every editor.

Drag and drop deliberately does _not_ write to the store while a drag is in flight.
`BoardCanvas` keeps a local draft board, applies `moveItem` to it on every `dragover` so
gaps open live, and commits once on drop. One drag, one undo step, one replay entry.

## The duel engine

`src/lib/duel.ts` is a pure state machine implementing an interactive binary insertion
sort. Each new item binary-searches its position in the already-sorted list, so placing
item _k_ costs ⌈log₂(k+1)⌉ comparisons instead of _k_.

| Items | Duels (RankRoom) | Duels (round-robin) |
| ----- | ---------------- | ------------------- |
| 10    | ~25              | 45                  |
| 20    | ~62              | 190                 |
| 50    | ~215             | 1,225               |

There are no promises and no callbacks: `answerDuel(state, verdict)` returns a new state.
That is what makes every step undoable — the history is just an array of past states — and
what lets the engine be tested by driving it with a known "true" ordering and asserting the
result comes back in exactly that order.

A **tie** places the newcomer directly below its rival and stops asking, because a tie is
the user saying the exact order is noise. A **skip** parks the item; it returns to the
bench unranked.

## Crowd mode

Audience participation with no backend at all, which is the whole trick.

**Getting the messages.** Twitch's IRC gateway accepts anonymous logins: connect to
`wss://irc-ws.chat.twitch.tv` as `justinfan<random>` and you receive every message in a
channel with no OAuth flow, no app registration and no server. It is `wss://`, so it works
from an HTTPS page. `src/lib/twitch.ts` does that, reconnects with exponential backoff, and
never sends anything but protocol keepalives — RankRoom holds no token and cannot post.

**Reading them as votes.** `src/lib/crowd.ts` is pure. `parseVote` is deliberately strict:
an unrecognised message is ignored rather than guessed at, because a wrong vote is worse
than a missed one when it is on screen. Votes are keyed by `user:item`, so a viewer can
change their mind but cannot stuff the ballot, and `pruneVotes` drops anything pointing at
an item or tier that no longer exists.

**Showing them.** `crowdGhosts` returns only _disagreements_ — items where the crowd's
winning tier differs from where the streamer put it. Agreement produces no ghost, which is
what keeps the layer readable: everything translucent on screen is a difference of opinion.

**The replay ending.** `crowdGhosts` also feeds the replay: after the placements finish,
the ghost layer fades in over the finished board and the hardest disagreement is ringed.
The ghosts occupy real cells, so `layoutBoard` is given them too — otherwise the board
grows during the reveal and overflows the frame it was scaled for.

**Who decides.** Nothing chat says moves a tile. The streamer accepts the crowd's pick for
the tile on deck, or applies the whole crowd ranking through the same `applyRanking` path
duel mode uses. That is a product decision as much as a technical one: the streamer stays
the author of their own list.

## Templates

`src/lib/templates.ts` is data, not code: a flat array the gallery filters, searches and
turns into boards. Three decisions are worth knowing before adding to it.

**Text only.** Bundling logos, box art or photographs would mean redistributing other
people's copyrighted work, for a feature whose whole point is that the user replaces the
tiles with their own images anyway. A test asserts the module contains no `data:image` and
no URLs, so this cannot drift.

**Templates carry vocabulary, not just items.** A fast-food board reads far better as
"Tonight … Never" than as S–F, so a template may bring its own ladder, palette and title.
That is most of what makes one feel authored rather than generated — and it is why
`boardFromTemplate` replaces the default tiers rather than only filling the bench.

**Locale is a filter, not just a translation.** Item names are proper nouns and shared, but
some lists only make sense in one language. `locales: ['fr']` keeps French streamers out of
the English gallery instead of showing a list nobody there recognises.

## Internationalisation

`src/i18n/en.ts` is the source of truth, and `fr.ts` is declared as
`Record<keyof typeof en, string>` — so a missing or misspelled key is a build error, not a
blank label in production. `translate()` handles `{placeholder}` substitution and picks
plural forms with `Intl.PluralRules` when a `count` parameter is present.

Errors thrown in `src/lib/` carry a **message key**, not a sentence (`RankRoomError`,
`BoardParseError`, `ImageImportError`). The library layer does not know the active locale,
so it names the message and the UI renders it. `errorKey(error, fallback)` narrows anything
thrown back to a key.

`src/i18n/locale.ts` holds only the locale type and browser detection, separate from the
translator, because the UI store needs it and the translator reads the locale _from_ that
store — importing the whole module would be a cycle.

## Rendering, exports and replays

There is exactly one renderer, `src/lib/render.ts`, drawing to a 2D canvas. It backs:

- the PNG export,
- the 1280×720 thumbnail,
- every frame of the replay video,
- the replay preview in the UI.

Drawing the board rather than screenshotting the DOM means output is pixel-identical
across browsers, and it avoids a heavyweight `html-to-image` dependency. `paintBoardTo`
draws into a caller-owned context, so the replay loop can hit 30 fps without allocating a
canvas or decoding an image per frame.

The replay itself is reconstructed, not recorded. `buildTimeline` replays the move log
forward from an empty board, which keeps the log tiny and guarantees the video ends on the
board you actually have. `recordReplay` then drives that timeline in real time through
`canvas.captureStream()` into `MediaRecorder`.

## Files

`src/lib/archive.ts` is a ZIP reader and writer in about a hundred lines. It exists rather
than a dependency because `CompressionStream` — already carrying share links — is the hard
part of ZIP; what remained was header layout, against ~100 KB of JSZip for a format we both
produce and consume.

`src/lib/boardFile.ts` sits on top with two formats. `.json` inlines images as data URLs:
readable, diffable, hand-editable. `.rankroom` is a zip of `board.json` plus `images/`
named after each tile, so unzipping gives your pictures back as pictures. The archive wins
on size above roughly 500 bytes an image — base64 costs 33%, ZIP about 150 bytes a file —
which is every real tile and no 1×1 pixel. Both bounds are pinned by tests, after the first
version of that test caught the claim being overstated.

Reading sniffs the leading bytes rather than trusting the extension, and an archived board
is folded back into a plain board _before_ `parseBoard` sees it, so a file gets exactly the
same scrutiny as a share link.

`src/lib/files.ts` handles folder drops. `DataTransfer.files` is empty for a directory, so
"drag your covers folder in" needs the non-standard `webkitGetAsEntry` walk — feature
detected once, because TypeScript's DOM lib claims it is always there and that is not true
of every engine.

## Storage

| What                                   | Where            | Why                                                                                   |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| Boards, autosave                       | IndexedDB        | A board with 60 image tiles is megabytes; localStorage caps the whole origin at ~5 MB |
| Theme, locale, tile size, crowd config | localStorage     | Tiny, and wanted synchronously on first paint                                         |
| Shared boards                          | The URL fragment | See below                                                                             |

Everything read back out of IndexedDB goes through `parseBoard` again. Records outlive app
versions, so they are treated as untrusted input like anything else.

## Share links

A share link is `#/b/<token>`, where the token is the whole board: JSON → `deflate-raw` →
base64url. Two properties fall out of putting it in the _fragment_:

1. **It is never sent to a server.** Browsers do not transmit fragments, so the host
   never sees what anyone ranked.
2. **It cannot rot.** The link contains the board, so it keeps working even if this site
   goes away.

The cost is length. Images are re-encoded to ~384px WebP to keep tokens small, and the
share dialog can drop images entirely for a much shorter, names-only link. Past
`SHARE_SIZE_WARNING` the UI says plainly that some chat clients will mangle the link.

## The optional server

Everything above works with no backend, and that is not a fallback — it is the default.
`server/` exists for the three things a browser cannot do alone: an identity that survives
a new device, a page other people can open, and an overlay OBS can follow live.

**It is a build-time flag, not a runtime one.** `src/lib/api.ts` reads `VITE_API_URL` at
import; when it is unset, `configured` is false, the account entry never enters the command
palette, the dialog is never mounted, and no request is ever made. An e2e test asserts
exactly that, because "still works without a backend" is a promise that stops being true
quietly.

**One origin, on purpose.** The server serves the built front end as well as the API, so a
request from the page to the API is same-origin _by construction_ rather than by proxy
configuration. That is what keeps the session cookie `SameSite=Lax` and keeps cross-site
request forgery out of the threat model. Splitting them across two hosts forces
`SameSite=None` and puts that surface back — which is precisely what the original
GitHub Pages plan would have required.

**The live overlay is why any of this exists.** An OBS Browser Source runs inside OBS's own
browser, a separate process, so `BroadcastChannel` cannot reach it; the only way in was a
URL with the board compressed into it, stale the moment a tile moved. `#/overlay/live/<key>`
subscribes to a server-sent event stream instead. The key authenticates alone, because a
Browser Source is a URL in a text field and cannot carry a session — so it is treated as a
credential: stored hashed, scoped to one streamer's feed, and revoked by rotation.

Routing is a table in `src/app/route.ts` with tests for the near-collisions, which is where
the bugs would be. `#/b/` already meant "a whole board compressed into this fragment", so a
server slug routed there would be handed to the decompressor and fail; published boards get
`#/p/` instead. `#/overlay/live/<key>` has to be matched before `#/overlay/<token>`, or
`live` is read as a share token.

## Security boundaries

Share links, pasted JSON and stored records are all attacker-controlled, and they render
into the DOM and into exported images. `src/lib/schema.ts` is the single gate.

- **Whitelist parsing.** Unknown keys are dropped; every value is re-derived rather than
  trusted. Placement is rebuilt from scratch, so an item cannot occupy two zones and a
  dangling id cannot render as a ghost tile.
- **Image URLs are pinned to inline raster data.** A `data:text/html` or `javascript:`
  value in `<img src>` is an XSS sink; only `data:image/(png|jpeg|webp|gif);base64,…`
  survives the filter. This is covered by tests that feed it real payloads.
- **Prototype keys are rejected.** `__proto__`, `constructor` and `prototype` cannot be
  used as item ids.
- **Text is stripped of control characters and bidi overrides**, which would otherwise let
  a crafted label reorder the text around it in the UI or in an export.
- **Everything is capped**: title, labels, tier count, item count, and image payload size.

On the outbound side, uploaded images are re-encoded before they are stored. That is a
privacy measure as much as a size one: re-encoding drops EXIF, including GPS coordinates
a creator would not expect to travel inside a share link.

When a server is involved, **all of it happens again there**, in `server/src/board.rs`,
against the same limits. The browser is a convenience, not a boundary: a request can be
crafted by hand, so nothing the client checked is taken on trust. The reverse also holds —
a board arriving _from_ the API goes through `parseBoard` like any file or link, because
where bytes came from is not a reason to trust their shape.

## Offline

`build/service-worker-plugin.ts` emits a dependency-free service worker at build time with
a precache list covering the bundle _and_ the static files under `public/` (fonts and
icons are copied, not bundled, so they have to be added explicitly). The cache name embeds
a hash of that list, so a new build evicts the old one. Navigations are network-first with
a cached fallback; hashed assets are cache-first.

Workbox would have done this too, at the cost of a large dependency tree for behaviour a
single static bundle does not need.

## Sizing, and why the tiles are small

A tier list is scanned as a whole, so more tiles per row beats bigger tiles — especially on
a phone, where an early build fitted three.

The measurable win came from deleting a column. Each row used to carry three hover-revealed
buttons stacked vertically: 88px of row height for a 52px tile, and controls that do not
exist on touch at all. Folding them into a single menu button inside the tier slug brought
rows to 60px and lifted a 390px screen from four tiles per row to five. Hover-only controls
are treated as a smell for that reason.

One CSS trap worth remembering, because it bit the template gallery: a grid or flex item
defaults to `min-width: auto`, so a long line of text sizes the track from its _content_
rather than its container. Cards measured 491px inside a 350px dialog on a phone. `min-w-0`
on the item is the fix, and it is worth adding pre-emptively to any grid child holding
free text.

## Drag and drop

`src/lib/dnd.ts` decides where a tile lands; the component only wires it up. That split
exists because the decision was where the bugs were, and "I drop it here and it goes
somewhere else" is not something a component test can pin down.

Three things had to be right, and all three were wrong at once:

- **Measuring.** Rows change size as tiles move between them, so droppable rectangles must
  be re-measured during the drag (`MeasuringStrategy.Always`). Cached rects meant every
  later drop resolved against a layout that no longer existed.
- **Collision.** `closestCorners` compares the drag against _every_ droppable, tiles
  included, so a far-away tile could beat the row the cursor was inside. Asking what is
  under the pointer first, and falling back to geometry only when it is outside
  everything, matches what the user sees.
- **Feedback.** Reordering inside a zone during `dragOver` moved the tile under the cursor,
  which made the cursor hover the tile itself, which made every later move a no-op — a
  tile stuck in the first slot it happened to reach. Same-zone ordering is left entirely to
  dnd-kit's sortable strategy; only crossing zones is previewed.

The bench also sits _outside_ the scrolling area. A drop target that can scroll out of
view is the worst kind, and a sticky one inside the scroller invalidates its own rect.

## Testing

Two layers, deliberately:

- **`src/**/*.test.ts`** — the pure domain logic and the stores, in jsdom. Fast, run on
  every commit, and where nearly all the coverage lives.
- **`e2e/`** — Playwright against the production build, for the things jsdom cannot
  answer: pointer drag and drop, canvas exports, native `<dialog>`, and share links
  surviving a real navigation. Run on a desktop and a phone viewport.

- **`server/tests/`** — three Rust suites: authorisation against a real Postgres, a pentest
  suite that boots the whole deployed stack and attacks it over HTTP, and a property test
  that puts a quarter of a million generated documents through the validator. Each pentest
  is named for the attack it performs, so a red run reads as a vulnerability report.

The split is a rule rather than a habit: if a test can be written without a browser, it is
written without one. The browser suite exists for the handful of behaviours that genuinely
need one — and every bug listed in the changelog under "drag and drop" is one of them.

Some bugs sit outside all three. The rate limiter was configured a hundred times stricter
than its own documentation, because `per_second` in `tower_governor` sets the interval
between replenishments rather than the rate; the existing flood test passed regardless,
since a limiter that is far too strict still refuses a flood. It took a browser hitting the
real stack to surface it. The test that now pins it exhausts the burst and measures how
fast the bucket refills — the property that actually differs.

## Accessibility

- One focus treatment, applied globally via `:focus-visible`, never removed.
- Drag and drop is fully keyboard-operable through dnd-kit's keyboard sensor, with custom
  screen-reader announcements that name the tier a tile is over.
- Dialogs are native `<dialog>` elements, so focus trapping, <kbd>Esc</kbd> and page
  inertness come from the platform rather than a focus-lock library.
- Every tier colour in every shipped palette clears WCAG AA against its label, and
  `readableInk` compares both inks rather than using a luminance threshold — thresholds
  pick the wrong ink for mid-tones, which is exactly where legibility is tightest. There is
  a test that asserts this for every palette.
- `prefers-reduced-motion` disables every animation, including the tally lamp.
