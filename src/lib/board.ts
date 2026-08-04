import {
  BENCH,
  type Board,
  type Item,
  type ItemId,
  type Tier,
  type TierId,
  type ZoneId,
} from '~/types'
import { createId, hueFromString } from './id'
import { colorAt, DEFAULT_PALETTE, type Palette } from './palette'

export const DEFAULT_TIER_LABELS = ['S', 'A', 'B', 'C', 'D', 'F'] as const

export function createTier(label: string, color: string): Tier {
  return { id: createId(), label, color, itemIds: [] }
}

export function createItem(label: string, image?: string): Item {
  const item: Item = { id: createId(), label, hue: hueFromString(label || createId()) }
  if (image) item.image = image
  return item
}

export function createBoard(options: { title?: string; palette?: Palette } = {}): Board {
  const palette = options.palette ?? DEFAULT_PALETTE
  const now = Date.now()

  return {
    schema: 1,
    id: createId(),
    title: options.title ?? 'Untitled ranking',
    subtitle: '',
    tiers: DEFAULT_TIER_LABELS.map((label, index) => createTier(label, colorAt(palette, index))),
    bench: [],
    items: {},
    createdAt: now,
    updatedAt: now,
  }
}

export function isBench(zone: ZoneId): boolean {
  return zone === BENCH
}

export function zoneItemIds(board: Board, zone: ZoneId): readonly ItemId[] {
  if (isBench(zone)) return board.bench
  return board.tiers.find((tier) => tier.id === zone)?.itemIds ?? []
}

/** The zone an item currently sits in, or null if the board does not hold it. */
export function zoneOf(board: Board, itemId: ItemId): ZoneId | null {
  if (board.bench.includes(itemId)) return BENCH
  const tier = board.tiers.find((candidate) => candidate.itemIds.includes(itemId))
  return tier ? tier.id : null
}

function withZone(board: Board, zone: ZoneId, itemIds: ItemId[]): Board {
  if (isBench(zone)) return { ...board, bench: itemIds }
  return {
    ...board,
    tiers: board.tiers.map((tier) => (tier.id === zone ? { ...tier, itemIds } : tier)),
  }
}

/** Removes an item from wherever it is, leaving every other zone untouched. */
function detach(board: Board, itemId: ItemId): Board {
  const zone = zoneOf(board, itemId)
  if (zone === null) return board
  return withZone(
    board,
    zone,
    zoneItemIds(board, zone).filter((id) => id !== itemId),
  )
}

function sameOrder(a: readonly ItemId[], b: readonly ItemId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * Moves an item to `toZone` at `toIndex`. Removing before inserting means the
 * index is always interpreted against the list the item is *landing* in, which
 * is what a drag preview shows the user.
 *
 * Returns the board unchanged when the item would land exactly where it already
 * is — dropping a tile back on itself must not cost an undo step or add a
 * phantom entry to the replay.
 */
export function moveItem(board: Board, itemId: ItemId, toZone: ZoneId, toIndex: number): Board {
  if (!(itemId in board.items)) return board
  if (!isBench(toZone) && !board.tiers.some((tier) => tier.id === toZone)) return board

  const from = zoneOf(board, itemId)
  const detached = detach(board, itemId)
  const target = [...zoneItemIds(detached, toZone)]
  const index = Math.max(0, Math.min(toIndex, target.length))
  target.splice(index, 0, itemId)

  if (from === toZone && sameOrder(target, zoneItemIds(board, toZone))) return board

  return touch(withZone(detached, toZone, target))
}

export function addItems(board: Board, items: readonly Item[]): Board {
  if (items.length === 0) return board

  const nextItems = { ...board.items }
  for (const item of items) nextItems[item.id] = item

  return touch({
    ...board,
    items: nextItems,
    bench: [...board.bench, ...items.map((item) => item.id)],
  })
}

export function removeItem(board: Board, itemId: ItemId): Board {
  if (!(itemId in board.items)) return board

  const detached = detach(board, itemId)
  const { [itemId]: _removed, ...nextItems } = detached.items

  return touch({ ...detached, items: nextItems })
}

export function renameItem(board: Board, itemId: ItemId, label: string): Board {
  const item = board.items[itemId]
  if (!item) return board
  return touch({ ...board, items: { ...board.items, [itemId]: { ...item, label } } })
}

export function addTier(board: Board, atIndex: number, palette: Palette): Board {
  const index = Math.max(0, Math.min(atIndex, board.tiers.length))
  const tiers = [...board.tiers]
  tiers.splice(index, 0, createTier(nextTierLabel(board), colorAt(palette, index)))
  return touch({ ...board, tiers })
}

function nextTierLabel(board: Board): string {
  const used = new Set(board.tiers.map((tier) => tier.label))
  const candidate = DEFAULT_TIER_LABELS.find((label) => !used.has(label))
  return candidate ?? `T${board.tiers.length + 1}`
}

/** Removing a tier never deletes work: its items go back to the bench. */
export function removeTier(board: Board, tierId: TierId): Board {
  const tier = board.tiers.find((candidate) => candidate.id === tierId)
  if (!tier || board.tiers.length <= 1) return board

  return touch({
    ...board,
    tiers: board.tiers.filter((candidate) => candidate.id !== tierId),
    bench: [...board.bench, ...tier.itemIds],
  })
}

export function updateTier(board: Board, tierId: TierId, patch: Partial<Omit<Tier, 'id'>>): Board {
  return touch({
    ...board,
    tiers: board.tiers.map((tier) => (tier.id === tierId ? { ...tier, ...patch } : tier)),
  })
}

export function moveTier(board: Board, fromIndex: number, toIndex: number): Board {
  if (fromIndex === toIndex) return board
  if (fromIndex < 0 || fromIndex >= board.tiers.length) return board

  const tiers = [...board.tiers]
  const [moved] = tiers.splice(fromIndex, 1)
  if (!moved) return board

  tiers.splice(Math.max(0, Math.min(toIndex, tiers.length)), 0, moved)
  return touch({ ...board, tiers })
}

export function applyPalette(board: Board, palette: Palette): Board {
  return touch({
    ...board,
    tiers: board.tiers.map((tier, index) => ({ ...tier, color: colorAt(palette, index) })),
  })
}

/** Sends every ranked item back to the bench, keeping tiers and items intact. */
export function resetPlacements(board: Board): Board {
  const ranked = board.tiers.flatMap((tier) => tier.itemIds)
  return touch({
    ...board,
    tiers: board.tiers.map((tier) => ({ ...tier, itemIds: [] })),
    bench: [...board.bench, ...ranked],
  })
}

export function shuffleBench(board: Board, random: () => number = Math.random): Board {
  return touch({ ...board, bench: shuffle(board.bench, random) })
}

/** Fisher–Yates, on a copy. */
export function shuffle<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) continue
    out[i] = b
    out[j] = a
  }
  return out
}

/** Resolves ids to items, dropping any that the board no longer holds. */
export function itemsIn(board: Board, ids: readonly ItemId[]): Item[] {
  return ids.map((id) => board.items[id]).filter((item): item is Item => item !== undefined)
}

export function itemCount(board: Board): number {
  return Object.keys(board.items).length
}

export function rankedCount(board: Board): number {
  return board.tiers.reduce((total, tier) => total + tier.itemIds.length, 0)
}

function touch(board: Board): Board {
  return { ...board, updatedAt: Date.now() }
}

/**
 * How many items each tier receives when `count` ranked items are spread over
 * tiers of the given relative `weights`.
 *
 * Shared by the duel results preview and the placement itself, so what the user
 * sees before applying is exactly what lands on the board.
 */
export function bucketSizes(count: number, weights: readonly number[]): number[] {
  const tierCount = weights.length
  if (tierCount === 0 || count <= 0) return new Array<number>(tierCount).fill(0)

  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
  if (total <= 0) return new Array<number>(tierCount).fill(0)

  const sizes = weights.map((weight) => Math.floor((Math.max(0, weight) / total) * count))
  // Hand out the rounding remainder from the top tier down.
  let assigned = sizes.reduce((sum, size) => sum + size, 0)
  for (let i = 0; assigned < count; i = (i + 1) % tierCount) {
    sizes[i] = (sizes[i] ?? 0) + 1
    assigned += 1
  }
  return sizes
}

/**
 * Spreads an ordered ranking across the board's tiers.
 *
 * `weights` describes the relative size of each tier from best to worst, so
 * `[1, 1.7, 2.4, 3.1]` means "a small S tier, a generous bottom". Every item
 * lands somewhere: rounding remainders go to the highest tiers.
 */
export function distributeRanking(
  board: Board,
  orderedIds: readonly ItemId[],
  weights?: readonly number[],
): Board {
  const tierCount = board.tiers.length
  if (tierCount === 0 || orderedIds.length === 0) return board

  const known = orderedIds.filter((id) => id in board.items)
  const raw = weights?.length === tierCount ? [...weights] : new Array<number>(tierCount).fill(1)
  const sizes = bucketSizes(known.length, raw)

  const buckets: ItemId[][] = []
  let cursor = 0
  for (const size of sizes) {
    buckets.push(known.slice(cursor, cursor + size))
    cursor += size
  }

  // Anything the ranking did not cover keeps its place on the bench rather than
  // silently disappearing — including items that were ranked before this call.
  const placed = new Set(known)
  const displaced = board.tiers.flatMap((tier) => tier.itemIds).filter((id) => !placed.has(id))

  return touch({
    ...board,
    tiers: board.tiers.map((tier, index) => ({ ...tier, itemIds: buckets[index] ?? [] })),
    bench: [...board.bench.filter((id) => !placed.has(id)), ...displaced],
  })
}
