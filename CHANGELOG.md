# Changelog

All notable changes to RankRoom are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **An optional self-hosted backend** (`server/`, Rust + Axum + Postgres) for
  Twitch sign-in, boards that follow you across devices, public profile pages, and
  a **live OBS overlay** — the thing a static site genuinely could not do. The app
  is unchanged without it: no `VITE_API_URL`, no backend, no difference.

- **Template gallery** — 26 ready-made boards across games, film and TV, music, food,
  brands, internet and everyday life, searchable by template name or by any item inside
  one. Templates can bring their own tier ladder ("Tonight → Never" for fast food), their
  own palette and their own title. Use one as a new board, or drop its items onto the
  current bench. All text, no bundled artwork.
- The empty board now leads with the gallery rather than with a file picker.

- **Multi-select** — shift or ⌘/Ctrl-click extends the selection, ⌘A takes everything.
  Dragging a selected tile moves the whole group, and the inspector becomes a bulk panel:
  move them all to a tier or the bench, or remove them together.
- **Your own credit on exports** — free text plus an optional logo, replacing the fixed
  RankRoom mark. Stored per creator rather than per board.
- **Open a board file** — `.json` or `.rankroom`, from the shelf, the command palette, or
  by dropping it on the page. Content is sniffed rather than trusted from the extension.
- **`.rankroom` archives** — a zip of `board.json` plus `images/` named after each tile.
  Roughly a quarter smaller than the JSON for real images, and unzippable.
- **Drop a whole folder** of images, or pick one. Entries are sorted naturally, so
  `01-…`, `02-…` land in the order they were numbered.
- **The replay can end on the crowd's verdict** — chat's picks fade in over the finished
  board with the biggest disagreement ringed in red.

- **Blind ranking challenges** — a share link that carries the tiles without your
  placements. They rank it unseen, and Compare lines the two up when they are done.
- **Weighted and moderated crowd votes** — subscriber, VIP and mod badges are read from
  the chat tags, so a channel can weight them, restrict voting, require a minimum before a
  ghost appears, or ignore a viewer outright. All off by default.
- **Sort a tier** A→Z, Z→A or at random, from the tier menu.
- **An error boundary**, so a render crash offers a reload instead of a white page — the
  board is autosaved, and the user needs to be told that.
- **End-to-end tests** in a real browser: pointer drag and drop, keyboard placement, the
  duel flow, exports, and share-link round trips, on a desktop and a phone viewport.

### Fixed

- **Drag and drop placed tiles in the wrong slot, then locked them there.** Three causes,
  all fixed: droppable rectangles were never re-measured while rows changed size,
  `closestCorners` could pick a tile in another row over the one under the pointer, and
  reordering inside a zone fed back on itself so a tile became stuck in the first slot it
  landed in. The placement decision now lives in `src/lib/dnd.ts`, covered by tests.
- **A tile could not be moved into an empty tier with the keyboard at all.**
  dnd-kit navigates between sortable _items_, so on a fresh board — where every tier is
  empty — there was nothing above to reach. Up and down now step between rows, left and
  right reorder within one, which is also the better model for a tier list. Found by the
  new browser tests, not by hand.
- **The replay exported WebM, which TikTok, Instagram and X all reject.** MP4 is preferred
  where the browser really supports it, which is Chrome 130+ and Safari.
- **Duel runs no longer evaporate.** The state lived in the component, so leaving the tab
  mid-run threw away every answer. It survives now, and an in-progress run has a visible
  way out.
- **The replay's landing pop never rendered.** The decay was measured from the previous
  step, leaving it fully decayed before its own window began.
- `<html lang>` was only updated when the locale changed, so a first visit from a French
  browser still announced the page as English to assistive technology.

## [1.0.0] — 2026-08-04

First public release.

### The board

- Drag and drop with a mouse, a finger or the keyboard, with screen-reader announcements
  naming the tier a tile is over.
- Drop or paste images anywhere on the page; they are re-encoded to small WebP, which caps
  the payload and strips EXIF.
- Text tiles, added one at a time or a whole pasted list at once.
- Add, rename, recolour, reorder and remove tiers. Removing one never deletes work.
- Undo and redo with edit coalescing, autosave to IndexedDB, and a shelf of saved boards.
- Five tier palettes, defaulting to SMPTE colour bars ordered by luminance.
- Studio and daylight themes, both WCAG AA on every shipped palette.

### Duel mode

- Rank by answering "which of these two is better?", using interactive binary insertion —
  about 62 duels for 20 items instead of the 190 a round robin needs.
- Ties, skips and a full undo history.
- Three ladder shapes — even, top-heavy, bell — previewed before they are applied.

### Stream mode and the OBS overlay

- Presenter view: one tile on deck, placed with a number key.
- A transparent overlay in two flavours — live over BroadcastChannel for a captured window,
  or with the board baked into the URL for an OBS Browser Source.
- A tally lamp that means what it means in a control room.

### Crowd mode

- Reads a Twitch channel directly from the page: anonymous, read-only, no bot and no server.
- Two ways to vote — a poll on the tile on deck, or free placement by name.
- One vote per viewer per item, with an optional expiry window.
- The audience result renders as a translucent ghost layer under the streamer's own
  placements, on the board and in the OBS overlay.
- Nothing chat says moves a tile on its own; the streamer accepts a pick or the whole
  ranking.

### Replay

- Every placement is logged and can be played back on a canvas.
- Records to a real video file, 16:9 or 9:16, at four speeds.

### Compare

- Loads a second board from a link or a `.json` and matches items by name.
- Scores agreement across boards with different tier counts, and surfaces the hot takes.

### Export and sharing

- PNG at three sizes, a 1280×720 thumbnail built from the top tier, and raw `.json`.
- Share links carry the whole board in the URL fragment, which is never sent to a server.

### Everywhere

- English and French, detected from the browser and switchable at any time.
- Command palette, keyboard shortcuts throughout, and a reduced-motion mode that means it.
- Works offline through a dependency-free service worker.

[unreleased]: https://github.com/micferna/rankroom/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/micferna/rankroom/releases/tag/v1.0.0
