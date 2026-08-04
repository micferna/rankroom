import type { MessageKey } from '~/i18n/en'
import type { Board, Item, ItemId, Tier } from '~/types'
import { createId, hueFromString } from './id'
import { DEFAULT_PALETTE, colorAt, isHexColor } from './palette'

/**
 * Boards arrive from share links, pasted JSON and files — all attacker-controlled.
 * Everything below is a whitelist: unknown keys are dropped, every value is
 * re-derived, and nothing from the input is trusted as-is.
 */

export const LIMITS = {
  title: 120,
  subtitle: 160,
  label: 80,
  tiers: 26,
  items: 400,
  /** ~200 KB of base64 per tile: generous for a 320px WebP, far below a DoS. */
  image: 280_000,
} as const

/** Only inline raster images. A `data:text/html` or `javascript:` URL here would be an XSS sink. */
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Carries a message *key*, not a sentence: these errors surface in the UI, which
 * is translated, so the wording is chosen at the point of display.
 */
export class BoardParseError extends Error {
  override readonly name = 'BoardParseError'
  readonly key: MessageKey

  constructor(key: MessageKey) {
    super(key)
    this.key = key
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Matching control characters is the entire point of this pattern.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g

function text(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  // Strip control characters and bidi overrides: a crafted label must not be
  // able to reorder the text around it in the UI or in an exported image.
  return value.replace(UNSAFE_TEXT, '').slice(0, max)
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && isHexColor(value) ? value : fallback
}

function image(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > LIMITS.image) return undefined
  return IMAGE_DATA_URL.test(value) ? value : undefined
}

function parseItem(raw: unknown): Item | null {
  if (!isRecord(raw)) return null

  const id = text(raw.id, 40)
  if (!id || FORBIDDEN_KEYS.has(id)) return null

  const label = text(raw.label, LIMITS.label)
  const src = image(raw.image)
  const hue =
    typeof raw.hue === 'number' && Number.isFinite(raw.hue)
      ? ((raw.hue % 360) + 360) % 360
      : hueFromString(label || id)

  const item: Item = { id, label, hue }
  if (src) item.image = src
  return item
}

/**
 * Parses an untrusted value into a Board, or throws BoardParseError.
 * Placement is rebuilt from scratch so an item can never end up in two zones,
 * and dangling ids are dropped instead of rendering as empty tiles.
 */
export function parseBoard(raw: unknown): Board {
  if (!isRecord(raw)) throw new BoardParseError('error.parse.notBoard')
  if (raw.schema !== 1) throw new BoardParseError('error.parse.version')

  const items: Record<ItemId, Item> = {}
  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : isRecord(raw.items)
      ? Object.values(raw.items)
      : []

  for (const candidate of rawItems.slice(0, LIMITS.items)) {
    const item = parseItem(candidate)
    if (item && !(item.id in items)) items[item.id] = item
  }

  const unplaced = new Set(Object.keys(items))
  const take = (value: unknown): ItemId[] => {
    if (!Array.isArray(value)) return []
    const out: ItemId[] = []
    for (const entry of value) {
      if (typeof entry !== 'string') continue
      if (!unplaced.delete(entry)) continue
      out.push(entry)
    }
    return out
  }

  const rawTiers = Array.isArray(raw.tiers) ? raw.tiers.slice(0, LIMITS.tiers) : []
  const tiers: Tier[] = rawTiers.filter(isRecord).map((rawTier, index) => ({
    id: text(rawTier.id, 40) || createId(),
    label: text(rawTier.label, 12, String.fromCharCode(65 + index)),
    color: color(rawTier.color, colorAt(DEFAULT_PALETTE, index)),
    itemIds: take(rawTier.itemIds),
  }))

  if (tiers.length === 0) throw new BoardParseError('error.parse.noTiers')

  // Duplicate tier ids would make drop targets ambiguous.
  const seenTierIds = new Set<string>()
  for (const tier of tiers) {
    if (seenTierIds.has(tier.id)) tier.id = createId()
    seenTierIds.add(tier.id)
  }

  const bench = [...take(raw.bench), ...unplaced]
  const now = Date.now()

  return {
    schema: 1,
    id: text(raw.id, 40) || createId(),
    title: text(raw.title, LIMITS.title, 'Untitled ranking'),
    subtitle: text(raw.subtitle, LIMITS.subtitle),
    tiers,
    bench,
    items,
    createdAt: typeof raw.createdAt === 'number' && raw.createdAt > 0 ? raw.createdAt : now,
    updatedAt: now,
  }
}

/** Compact wire form: items become an array, and empty fields are dropped. */
export function serializeBoard(board: Board, options: { images?: boolean } = {}): unknown {
  const withImages = options.images ?? true

  return {
    schema: 1,
    id: board.id,
    title: board.title,
    ...(board.subtitle ? { subtitle: board.subtitle } : {}),
    tiers: board.tiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      color: tier.color,
      itemIds: tier.itemIds,
    })),
    bench: board.bench,
    items: Object.values(board.items).map((item) => ({
      id: item.id,
      label: item.label,
      hue: item.hue,
      ...(withImages && item.image ? { image: item.image } : {}),
    })),
    createdAt: board.createdAt,
  }
}
