export type ItemId = string
export type TierId = string

/** Items that have not been ranked yet wait on the bench. */
export const BENCH = 'bench'

/**
 * Every item lives in exactly one zone: a tier row (a `TierId`) or `BENCH`.
 * Ids are opaque strings, so this is an alias rather than a union — a union of
 * `string | 'bench'` would collapse to `string` and only look more precise.
 */
export type ZoneId = string

export interface Item {
  id: ItemId
  label: string
  /**
   * Downscaled WebP data URL. Absent for text-only tiles, which fall back to a
   * generated swatch so a board stays readable without any uploads.
   */
  image?: string
  /** Derived from the label so a text tile keeps the same colour across reloads. */
  hue: number
}

export interface Tier {
  id: TierId
  label: string
  /** Hex, authored by the user or taken from a palette preset. */
  color: string
  itemIds: ItemId[]
}

export interface Board {
  /** Bumped whenever the persisted shape changes; see lib/migrate.ts. */
  schema: 1
  id: string
  title: string
  subtitle: string
  tiers: Tier[]
  bench: ItemId[]
  items: Record<ItemId, Item>
  createdAt: number
  updatedAt: number
}

/** One placement, recorded so a session can be replayed and exported as video. */
export interface Move {
  /** Milliseconds since the first move of the session. */
  at: number
  itemId: ItemId
  from: ZoneId
  to: ZoneId
  toIndex: number
}

export type ThemeName = 'studio' | 'daylight'

/** Messages the editor sends to the OBS overlay over BroadcastChannel. */
export type OverlayMessage =
  | { type: 'board'; board: Board }
  | { type: 'reveal'; itemId: ItemId | null; tierId: TierId | null }
  | { type: 'live'; live: boolean }
  | { type: 'hello' }

export interface CompareRow {
  itemId: ItemId
  label: string
  image?: string
  /** Tier index in each board, or null when the item is unranked/absent. */
  left: number | null
  right: number | null
  /** Absolute tier distance; null when the item exists in only one board. */
  gap: number | null
}

export interface CompareResult {
  rows: CompareRow[]
  /** 1 = identical rankings, 0 = every item at opposite ends. */
  agreement: number
  /** Items both boards ranked in the very same relative position. */
  exactMatches: number
  /** Items ranked in both boards, i.e. the ones `agreement` is computed from. */
  measured: number
  /** Items both boards contain, ranked or benched. */
  shared: number
  onlyLeft: number
  onlyRight: number
  /** Biggest disagreements first. */
  hotTakes: CompareRow[]
}
