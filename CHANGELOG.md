# Changelog

All notable changes to RankRoom are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Template gallery** — 26 ready-made boards across games, film and TV, music, food,
  brands, internet and everyday life, searchable by template name or by any item inside
  one. Templates can bring their own tier ladder ("Tonight → Never" for fast food), their
  own palette and their own title. Use one as a new board, or drop its items onto the
  current bench. All text, no bundled artwork.
- The empty board now leads with the gallery rather than with a file picker.

### Fixed

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
