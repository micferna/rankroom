import type { Board, ItemId, TierId } from '~/types'

/**
 * Turns chat into a second, translucent ranking laid over the streamer's own.
 *
 * Two modes, because a live show and a long stream want different things:
 *
 *   • `deck` — everyone votes on the one tile currently on deck. A viewer types
 *     just the tier letter. This is the poll a streamer runs on camera.
 *   • `free` — viewers place anything at any time with `!s dune`. This is the
 *     ambient version that runs quietly through a whole stream.
 *
 * One vote per viewer per item, latest wins, so nobody can spam the result.
 * Everything here is pure: the chat client feeds it, the UI reads it.
 */

export type CrowdMode = 'deck' | 'free'

export interface CrowdConfig {
  mode: CrowdMode
  /** Prefix for free-placement commands. Empty means "bare tier letter". */
  prefix: string
  /** Ignore votes for items already placed by the streamer. */
  openOnly: boolean
  /** Votes older than this stop counting, so a poll can move on. Ms; 0 = never. */
  windowMs: number
}

export const DEFAULT_CROWD_CONFIG: CrowdConfig = {
  mode: 'deck',
  prefix: '!',
  openOnly: false,
  windowMs: 0,
}

export interface CrowdVote {
  user: string
  display: string
  itemId: ItemId
  tierId: TierId
  at: number
}

/** Votes keyed by `${user}:${itemId}`, so a viewer can revise but not stuff. */
export type CrowdVotes = ReadonlyMap<string, CrowdVote>

export interface CrowdPlacement {
  itemId: ItemId
  /** Tier with the most votes. */
  tierId: TierId
  votes: number
  /** Share of that item's votes the winner took, 0–1. */
  share: number
  /** Votes per tier, for the bars. */
  breakdown: { tierId: TierId; votes: number }[]
}

export interface CrowdTally {
  placements: Map<ItemId, CrowdPlacement>
  voters: number
  total: number
}

function voteKey(user: string, itemId: ItemId): string {
  return `${user}:${itemId}`
}

/** Normalises a tier label for matching: "S" and "s " are the same tier. */
function normaliseLabel(value: string): string {
  return value.trim().toLowerCase()
}

/** Normalises an item name the way `!s dune part two` should match "Dune Part Two". */
function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export interface ParseContext {
  board: Board
  config: CrowdConfig
  /** The tile being voted on in `deck` mode. */
  deckItemId: ItemId | null
}

/**
 * Reads one chat line as a vote, or returns null when it is just chat.
 *
 * Deliberately strict: an unrecognised message is ignored rather than guessed
 * at, because a wrong vote is worse than a missed one when it is on screen.
 */
export function parseVote(
  text: string,
  context: ParseContext,
): Omit<CrowdVote, 'user' | 'display' | 'at'> | null {
  const { board, config, deckItemId } = context
  const trimmed = text.trim()
  if (!trimmed) return null

  const tierByLabel = new Map<string, TierId>()
  for (const tier of board.tiers) tierByLabel.set(normaliseLabel(tier.label), tier.id)

  if (config.mode === 'deck') {
    if (deckItemId === null) return null

    // A bare tier letter, optionally prefixed: "s", "!s", "S".
    const body =
      config.prefix && trimmed.startsWith(config.prefix)
        ? trimmed.slice(config.prefix.length)
        : trimmed

    const tierId = tierByLabel.get(normaliseLabel(body))
    return tierId === undefined ? null : { itemId: deckItemId, tierId }
  }

  // Free mode: "<prefix><tier> <item name>".
  if (config.prefix && !trimmed.startsWith(config.prefix)) return null
  const body = config.prefix ? trimmed.slice(config.prefix.length) : trimmed

  const space = body.search(/\s/)
  if (space === -1) return null

  const tierId = tierByLabel.get(normaliseLabel(body.slice(0, space)))
  if (tierId === undefined) return null

  const target = normaliseName(body.slice(space + 1))
  if (!target) return null

  const item = Object.values(board.items).find((candidate) => {
    const name = normaliseName(candidate.label)
    // Prefix matching lets "!s dune" hit "Dune Part Two" without exact typing.
    return name === target || (target.length >= 3 && name.startsWith(target))
  })

  if (!item) return null
  if (config.openOnly && board.tiers.some((tier) => tier.itemIds.includes(item.id))) return null

  return { itemId: item.id, tierId }
}

/** Applies a vote, replacing that viewer's previous vote for the same item. */
export function castVote(votes: CrowdVotes, vote: CrowdVote): Map<string, CrowdVote> {
  const next = new Map(votes)
  next.set(voteKey(vote.user, vote.itemId), vote)
  return next
}

/** Drops votes for items or tiers the board no longer has, plus expired ones. */
export function pruneVotes(
  votes: CrowdVotes,
  board: Board,
  windowMs: number,
  now: number,
): Map<string, CrowdVote> {
  const tierIds = new Set(board.tiers.map((tier) => tier.id))
  const next = new Map<string, CrowdVote>()

  for (const [key, vote] of votes) {
    if (!(vote.itemId in board.items)) continue
    if (!tierIds.has(vote.tierId)) continue
    if (windowMs > 0 && now - vote.at > windowMs) continue
    next.set(key, vote)
  }
  return next
}

export function tallyVotes(votes: CrowdVotes, board: Board): CrowdTally {
  const perItem = new Map<ItemId, Map<TierId, number>>()
  const voters = new Set<string>()

  for (const vote of votes.values()) {
    voters.add(vote.user)
    const tiers = perItem.get(vote.itemId) ?? new Map<TierId, number>()
    tiers.set(vote.tierId, (tiers.get(vote.tierId) ?? 0) + 1)
    perItem.set(vote.itemId, tiers)
  }

  const placements = new Map<ItemId, CrowdPlacement>()
  const order = new Map(board.tiers.map((tier, index) => [tier.id, index]))

  for (const [itemId, tiers] of perItem) {
    const breakdown = [...tiers.entries()]
      .map(([tierId, count]) => ({ tierId, votes: count }))
      // Ties break towards the better tier, which is the generous reading.
      .sort((a, b) => b.votes - a.votes || (order.get(a.tierId) ?? 0) - (order.get(b.tierId) ?? 0))

    const winner = breakdown[0]
    if (!winner) continue

    const total = breakdown.reduce((sum, entry) => sum + entry.votes, 0)
    placements.set(itemId, {
      itemId,
      tierId: winner.tierId,
      votes: winner.votes,
      share: total === 0 ? 0 : winner.votes / total,
      breakdown,
    })
  }

  return { placements, voters: voters.size, total: votes.size }
}

/**
 * Where the crowd would put each item, ready to draw as a ghost layer.
 * Items the streamer already agrees with are dropped: the ghost only ever shows
 * a difference of opinion, which is the whole point of putting it on screen.
 */
export function crowdGhosts(tally: CrowdTally, board: Board): Map<TierId, CrowdPlacement[]> {
  const byTier = new Map<TierId, CrowdPlacement[]>()

  for (const placement of tally.placements.values()) {
    const own = board.tiers.find((tier) => tier.itemIds.includes(placement.itemId))
    if (own?.id === placement.tierId) continue

    const list = byTier.get(placement.tierId) ?? []
    list.push(placement)
    byTier.set(placement.tierId, list)
  }

  for (const list of byTier.values()) list.sort((a, b) => b.votes - a.votes)
  return byTier
}

/** The crowd's ranking as an ordered id list, for "apply the crowd's verdict". */
export function crowdOrder(tally: CrowdTally, board: Board): ItemId[] {
  const order = new Map(board.tiers.map((tier, index) => [tier.id, index]))

  return [...tally.placements.values()]
    .sort(
      (a, b) =>
        (order.get(a.tierId) ?? 0) - (order.get(b.tierId) ?? 0) ||
        b.share - a.share ||
        b.votes - a.votes,
    )
    .map((placement) => placement.itemId)
}
