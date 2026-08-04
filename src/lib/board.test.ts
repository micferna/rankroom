import { describe, expect, it } from 'vitest'
import {
  addItems,
  addTier,
  bucketSizes,
  createBoard,
  createItem,
  distributeRanking,
  itemsIn,
  moveItem,
  moveTier,
  removeItem,
  removeTier,
  resetPlacements,
  shuffle,
  zoneOf,
} from './board'
import { DEFAULT_PALETTE } from './palette'
import { BENCH, type Board } from '~/types'

function boardWith(labels: string[]): Board {
  return addItems(
    createBoard(),
    labels.map((label) => createItem(label)),
  )
}

describe('moveItem', () => {
  it('places a benched item into a tier', () => {
    const board = boardWith(['a'])
    const itemId = board.bench[0]!
    const tierId = board.tiers[0]!.id

    const next = moveItem(board, itemId, tierId, 0)

    expect(next.bench).toEqual([])
    expect(next.tiers[0]!.itemIds).toEqual([itemId])
    expect(zoneOf(next, itemId)).toBe(tierId)
  })

  it('never leaves an item in two zones at once', () => {
    let board = boardWith(['a', 'b', 'c'])
    const [first, second] = board.bench
    const tierId = board.tiers[0]!.id

    board = moveItem(board, first!, tierId, 0)
    board = moveItem(board, second!, tierId, 0)
    board = moveItem(board, first!, BENCH, 0)

    const seen = [...board.bench, ...board.tiers.flatMap((tier) => tier.itemIds)]
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(3)
  })

  it('reorders within a zone, treating the index as the landing position', () => {
    let board = boardWith(['a', 'b', 'c'])
    const [a, b, c] = board.bench
    const tierId = board.tiers[0]!.id

    board = moveItem(board, a!, tierId, 0)
    board = moveItem(board, b!, tierId, 1)
    board = moveItem(board, c!, tierId, 2)
    board = moveItem(board, a!, tierId, 2)

    expect(board.tiers[0]!.itemIds).toEqual([b, c, a])
  })

  it('clamps an out-of-range index instead of creating holes', () => {
    const board = boardWith(['a'])
    const itemId = board.bench[0]!
    const tierId = board.tiers[0]!.id

    expect(moveItem(board, itemId, tierId, 99).tiers[0]!.itemIds).toEqual([itemId])
    expect(moveItem(board, itemId, tierId, -5).tiers[0]!.itemIds).toEqual([itemId])
  })

  it('ignores unknown items and unknown zones', () => {
    const board = boardWith(['a'])
    expect(moveItem(board, 'nope', board.tiers[0]!.id, 0)).toBe(board)
    expect(moveItem(board, board.bench[0]!, 'nope', 0)).toBe(board)
  })
})

describe('tiers', () => {
  it('returns a removed tier’s items to the bench rather than deleting them', () => {
    let board = boardWith(['a', 'b'])
    const tierId = board.tiers[0]!.id
    board = moveItem(board, board.bench[0]!, tierId, 0)

    const next = removeTier(board, tierId)

    expect(next.tiers).toHaveLength(board.tiers.length - 1)
    expect(next.bench).toHaveLength(2)
    expect(Object.keys(next.items)).toHaveLength(2)
  })

  it('refuses to remove the last tier', () => {
    let board = createBoard()
    while (board.tiers.length > 1) board = removeTier(board, board.tiers[0]!.id)

    expect(removeTier(board, board.tiers[0]!.id)).toBe(board)
  })

  it('moves a tier and leaves the rest in order', () => {
    const board = createBoard()
    const labels = board.tiers.map((tier) => tier.label)

    const next = moveTier(board, 0, 2)

    expect(next.tiers.map((tier) => tier.label)).toEqual([
      labels[1],
      labels[2],
      labels[0],
      ...labels.slice(3),
    ])
  })

  it('adds a tier with an unused label', () => {
    const board = addTier(createBoard(), 0, DEFAULT_PALETTE)
    const labels = board.tiers.map((tier) => tier.label)

    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('removeItem', () => {
  it('drops the item from both the index and its zone', () => {
    let board = boardWith(['a', 'b'])
    const itemId = board.bench[0]!
    board = moveItem(board, itemId, board.tiers[0]!.id, 0)

    const next = removeItem(board, itemId)

    expect(next.items[itemId]).toBeUndefined()
    expect(zoneOf(next, itemId)).toBeNull()
    expect(Object.keys(next.items)).toHaveLength(1)
  })
})

describe('resetPlacements', () => {
  it('sends everything back to the bench without losing items', () => {
    let board = boardWith(['a', 'b', 'c'])
    board = moveItem(board, board.bench[0]!, board.tiers[0]!.id, 0)
    board = moveItem(board, board.bench[0]!, board.tiers[1]!.id, 0)

    const next = resetPlacements(board)

    expect(next.bench).toHaveLength(3)
    expect(next.tiers.every((tier) => tier.itemIds.length === 0)).toBe(true)
  })
})

describe('bucketSizes', () => {
  it('assigns every item exactly once', () => {
    for (const count of [0, 1, 7, 23, 100]) {
      const sizes = bucketSizes(count, [1, 1, 1, 1, 1, 1])
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(count)
    }
  })

  it('honours relative weights', () => {
    const sizes = bucketSizes(100, [1, 4])
    expect(sizes[0]).toBeLessThan(sizes[1]!)
  })

  it('survives zero and negative weights', () => {
    expect(bucketSizes(10, [0, 0])).toEqual([0, 0])
    expect(bucketSizes(10, [-1, 1]).reduce((a, b) => a + b, 0)).toBe(10)
  })
})

describe('distributeRanking', () => {
  it('places the whole ranking and empties the bench', () => {
    const board = boardWith(['a', 'b', 'c', 'd', 'e', 'f'])
    const order = [...board.bench]

    const next = distributeRanking(board, order)

    expect(next.bench).toEqual([])
    expect(next.tiers.flatMap((tier) => tier.itemIds)).toHaveLength(6)
  })

  it('keeps the ranking order across tiers', () => {
    const board = boardWith(['a', 'b', 'c', 'd', 'e', 'f'])
    const order = [...board.bench]

    const next = distributeRanking(board, order)

    expect(next.tiers.flatMap((tier) => tier.itemIds)).toEqual(order)
  })

  it('benches items the ranking did not mention', () => {
    const board = boardWith(['a', 'b', 'c'])
    const [a] = board.bench

    const next = distributeRanking(board, [a!])

    expect(next.tiers.flatMap((tier) => tier.itemIds)).toEqual([a])
    expect(next.bench).toHaveLength(2)
  })

  it('ignores ids that are not on the board', () => {
    const board = boardWith(['a'])
    const next = distributeRanking(board, [...board.bench, 'ghost'])

    expect(next.tiers.flatMap((tier) => tier.itemIds)).toHaveLength(1)
  })
})

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const values = ['a', 'b', 'c', 'd', 'e']
    // A deterministic generator keeps the assertion stable.
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }

    const out = shuffle(values, random)

    expect([...out].sort()).toEqual([...values].sort())
  })
})

describe('itemsIn', () => {
  it('drops ids the board no longer holds', () => {
    const board = boardWith(['a'])
    expect(itemsIn(board, [...board.bench, 'ghost'])).toHaveLength(1)
  })
})

describe('no-op moves', () => {
  it('returns the same board when a tile lands where it already is', () => {
    let board = boardWith(['a', 'b'])
    const tierId = board.tiers[0]!.id
    board = moveItem(board, board.bench[0]!, tierId, 0)

    const itemId = board.tiers[0]!.itemIds[0]!
    expect(moveItem(board, itemId, tierId, 0)).toBe(board)
  })

  it('still moves when the index actually changes', () => {
    let board = boardWith(['a', 'b'])
    const tierId = board.tiers[0]!.id
    board = moveItem(board, board.bench[0]!, tierId, 0)
    board = moveItem(board, board.bench[0]!, tierId, 1)

    const [first] = board.tiers[0]!.itemIds
    expect(moveItem(board, first!, tierId, 1)).not.toBe(board)
  })
})
