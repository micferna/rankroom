import { describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem, moveItem } from './board'
import {
  castVote,
  crowdGhosts,
  crowdOrder,
  DEFAULT_CROWD_CONFIG,
  parseVote,
  pruneVotes,
  tallyVotes,
  type CrowdConfig,
  type CrowdVote,
} from './crowd'
import type { Board } from '~/types'

function boardWith(labels: string[]): Board {
  return addItems(
    createBoard(),
    labels.map((label) => createItem(label)),
  )
}

function vote(user: string, itemId: string, tierId: string, at = 1_000): CrowdVote {
  return { user, display: user, itemId, tierId, at }
}

const deck = (patch: Partial<CrowdConfig> = {}): CrowdConfig => ({
  ...DEFAULT_CROWD_CONFIG,
  mode: 'deck',
  ...patch,
})

const free = (patch: Partial<CrowdConfig> = {}): CrowdConfig => ({
  ...DEFAULT_CROWD_CONFIG,
  mode: 'free',
  ...patch,
})

describe('parseVote in deck mode', () => {
  const board = boardWith(['Dune Part Two'])
  const deckItemId = board.bench[0]!

  it('reads a bare tier letter', () => {
    expect(parseVote('s', { board, config: deck({ prefix: '' }), deckItemId })).toEqual({
      itemId: deckItemId,
      tierId: board.tiers[0]!.id,
    })
  })

  it('accepts the configured prefix and is case-insensitive', () => {
    expect(parseVote('!S', { board, config: deck(), deckItemId })).toEqual({
      itemId: deckItemId,
      tierId: board.tiers[0]!.id,
    })
  })

  it('ignores ordinary chat', () => {
    for (const text of ['hello', 'sss', 'this show is S tier honestly', '']) {
      expect(parseVote(text, { board, config: deck({ prefix: '' }), deckItemId })).toBeNull()
    }
  })

  it('ignores an unknown tier letter', () => {
    expect(parseVote('z', { board, config: deck({ prefix: '' }), deckItemId })).toBeNull()
  })

  it('counts nothing when no tile is on deck', () => {
    expect(parseVote('s', { board, config: deck({ prefix: '' }), deckItemId: null })).toBeNull()
  })
})

describe('parseVote in free mode', () => {
  const board = boardWith(['Dune Part Two', 'Arrival'])

  it('places a named item', () => {
    const result = parseVote('!s arrival', { board, config: free(), deckItemId: null })
    expect(result?.tierId).toBe(board.tiers[0]!.id)
    expect(board.items[result!.itemId]?.label).toBe('Arrival')
  })

  it('matches on a prefix, so viewers need not type the full name', () => {
    const result = parseVote('!a dune', { board, config: free(), deckItemId: null })
    expect(board.items[result!.itemId]?.label).toBe('Dune Part Two')
  })

  it('ignores a too-short fragment rather than guessing', () => {
    expect(parseVote('!a du', { board, config: free(), deckItemId: null })).toBeNull()
  })

  it('requires the prefix when one is configured', () => {
    expect(parseVote('s arrival', { board, config: free(), deckItemId: null })).toBeNull()
  })

  it('ignores an unknown item', () => {
    expect(parseVote('!s nothing here', { board, config: free(), deckItemId: null })).toBeNull()
  })

  it('can refuse votes on already-ranked items', () => {
    const itemId = board.bench[0]!
    const ranked = moveItem(board, itemId, board.tiers[0]!.id, 0)

    expect(
      parseVote('!a dune', { board: ranked, config: free({ openOnly: true }), deckItemId: null }),
    ).toBeNull()
    expect(
      parseVote('!a dune', { board: ranked, config: free({ openOnly: false }), deckItemId: null }),
    ).not.toBeNull()
  })
})

describe('castVote', () => {
  it('keeps one vote per viewer per item, latest wins', () => {
    const board = boardWith(['a'])
    const itemId = board.bench[0]!

    let votes = castVote(new Map(), vote('viewer', itemId, board.tiers[0]!.id))
    votes = castVote(votes, vote('viewer', itemId, board.tiers[2]!.id))

    const tally = tallyVotes(votes, board)
    expect(tally.total).toBe(1)
    expect(tally.placements.get(itemId)?.tierId).toBe(board.tiers[2]!.id)
  })

  it('lets one viewer vote on several items', () => {
    const board = boardWith(['a', 'b'])
    const [first, second] = board.bench

    let votes = castVote(new Map(), vote('viewer', first!, board.tiers[0]!.id))
    votes = castVote(votes, vote('viewer', second!, board.tiers[1]!.id))

    const tally = tallyVotes(votes, board)
    expect(tally.total).toBe(2)
    expect(tally.voters).toBe(1)
  })
})

describe('tallyVotes', () => {
  it('picks the tier with the most votes and reports its share', () => {
    const board = boardWith(['a'])
    const itemId = board.bench[0]!

    let votes = new Map()
    votes = castVote(votes, vote('u1', itemId, board.tiers[0]!.id))
    votes = castVote(votes, vote('u2', itemId, board.tiers[0]!.id))
    votes = castVote(votes, vote('u3', itemId, board.tiers[1]!.id))

    const placement = tallyVotes(votes, board).placements.get(itemId)
    expect(placement?.tierId).toBe(board.tiers[0]!.id)
    expect(placement?.votes).toBe(2)
    expect(placement?.share).toBeCloseTo(2 / 3)
  })

  it('breaks a tie towards the better tier', () => {
    const board = boardWith(['a'])
    const itemId = board.bench[0]!

    let votes = new Map()
    votes = castVote(votes, vote('u1', itemId, board.tiers[3]!.id))
    votes = castVote(votes, vote('u2', itemId, board.tiers[1]!.id))

    expect(tallyVotes(votes, board).placements.get(itemId)?.tierId).toBe(board.tiers[1]!.id)
  })

  it('counts distinct voters, not votes', () => {
    const board = boardWith(['a', 'b'])
    const [first, second] = board.bench

    let votes = new Map()
    votes = castVote(votes, vote('u1', first!, board.tiers[0]!.id))
    votes = castVote(votes, vote('u1', second!, board.tiers[0]!.id))
    votes = castVote(votes, vote('u2', first!, board.tiers[0]!.id))

    const tally = tallyVotes(votes, board)
    expect(tally.voters).toBe(2)
    expect(tally.total).toBe(3)
  })
})

describe('pruneVotes', () => {
  it('drops votes for items the board no longer holds', () => {
    const board = boardWith(['a'])
    const votes = castVote(new Map(), vote('u1', 'ghost-item', board.tiers[0]!.id))

    expect(pruneVotes(votes, board, 0, 2_000).size).toBe(0)
  })

  it('drops votes for tiers that were removed', () => {
    const board = boardWith(['a'])
    const votes = castVote(new Map(), vote('u1', board.bench[0]!, 'ghost-tier'))

    expect(pruneVotes(votes, board, 0, 2_000).size).toBe(0)
  })

  it('expires votes outside the window, and keeps them when there is none', () => {
    const board = boardWith(['a'])
    const votes = castVote(new Map(), vote('u1', board.bench[0]!, board.tiers[0]!.id, 1_000))

    expect(pruneVotes(votes, board, 500, 2_000).size).toBe(0)
    expect(pruneVotes(votes, board, 5_000, 2_000).size).toBe(1)
    expect(pruneVotes(votes, board, 0, 10_000_000).size).toBe(1)
  })
})

describe('crowdGhosts', () => {
  it('shows only disagreements', () => {
    let board = boardWith(['agree', 'differ'])
    const [agreeId, differId] = board.bench
    board = moveItem(board, agreeId!, board.tiers[0]!.id, 0)
    board = moveItem(board, differId!, board.tiers[0]!.id, 1)

    let votes = new Map()
    votes = castVote(votes, vote('u1', agreeId!, board.tiers[0]!.id))
    votes = castVote(votes, vote('u2', differId!, board.tiers[3]!.id))

    const ghosts = crowdGhosts(tallyVotes(votes, board), board)

    expect(ghosts.get(board.tiers[0]!.id)).toBeUndefined()
    expect(ghosts.get(board.tiers[3]!.id)?.[0]?.itemId).toBe(differId)
  })

  it('shows a ghost for an item the streamer has not placed at all', () => {
    const board = boardWith(['benched'])
    const itemId = board.bench[0]!
    const votes = castVote(new Map(), vote('u1', itemId, board.tiers[1]!.id))

    expect(crowdGhosts(tallyVotes(votes, board), board).get(board.tiers[1]!.id)).toHaveLength(1)
  })
})

describe('crowdOrder', () => {
  it('orders items best tier first', () => {
    const board = boardWith(['top', 'bottom'])
    const [top, bottom] = board.bench

    let votes = new Map()
    votes = castVote(votes, vote('u1', bottom!, board.tiers[4]!.id))
    votes = castVote(votes, vote('u2', top!, board.tiers[0]!.id))

    expect(crowdOrder(tallyVotes(votes, board), board)).toEqual([top, bottom])
  })

  it('is empty when nobody voted', () => {
    expect(crowdOrder(tallyVotes(new Map(), boardWith(['a'])), boardWith(['a']))).toEqual([])
  })
})
