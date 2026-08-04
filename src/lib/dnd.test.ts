import { describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem, moveItem } from './board'
import { finalDrop, overZone, previewDrop } from './dnd'
import { BENCH, type Board } from '~/types'

/** A board with `bench` on the bench and `tier0` already in the top tier. */
function scenario(bench: string[], tier0: string[] = []) {
  let board: Board = addItems(
    createBoard(),
    [...tier0, ...bench].map((label) => createItem(label)),
  )
  const id = (label: string) => Object.values(board.items).find((item) => item.label === label)!.id

  tier0.forEach((label, index) => {
    board = moveItem(board, id(label), board.tiers[0]!.id, index)
  })

  return { board, id, tier: (index: number) => board.tiers[index]!.id }
}

describe('overZone', () => {
  it('resolves a tier id to itself', () => {
    const { board, tier } = scenario(['a'])
    expect(overZone(board, tier(0))).toBe(tier(0))
  })

  it('resolves the bench id to the bench', () => {
    const { board } = scenario(['a'])
    expect(overZone(board, BENCH)).toBe(BENCH)
  })

  it('resolves a tile id to the zone holding it', () => {
    const { board, id, tier } = scenario(['a'], ['b'])
    expect(overZone(board, id('b'))).toBe(tier(0))
    expect(overZone(board, id('a'))).toBe(BENCH)
  })

  it('returns null for something unknown', () => {
    const { board } = scenario(['a'])
    expect(overZone(board, 'ghost')).toBeNull()
  })
})

describe('previewDrop', () => {
  it('moves a bench tile into the tier it is hovering', () => {
    const { board, id, tier } = scenario(['a'], ['x', 'y'])
    expect(previewDrop(board, id('a'), tier(0))).toEqual({ zone: tier(0), index: 2 })
  })

  it('inserts at the hovered tile’s position when crossing zones', () => {
    const { board, id, tier } = scenario(['a'], ['x', 'y'])
    expect(previewDrop(board, id('a'), id('y'))).toEqual({ zone: tier(0), index: 1 })
  })

  it('does nothing inside one zone — that is the sortable strategy’s job', () => {
    const { board, id } = scenario(['a', 'b', 'c'])
    expect(previewDrop(board, id('a'), id('c'))).toBeNull()
  })

  it('does nothing when hovering itself', () => {
    const { board, id } = scenario(['a'])
    expect(previewDrop(board, id('a'), id('a'))).toBeNull()
  })

  it('ignores an unknown target', () => {
    const { board, id } = scenario(['a'])
    expect(previewDrop(board, id('a'), 'ghost')).toBeNull()
  })
})

describe('finalDrop', () => {
  it('lands on the hovered tile’s index, matching arrayMove', () => {
    const { board, id, tier } = scenario([], ['a', 'b', 'c'])
    const target = finalDrop(board, id('a'), id('c'))

    expect(target).toEqual({ zone: tier(0), index: 2 })
    const moved = moveItem(board, id('a'), target!.zone, target!.index)
    expect(moved.tiers[0]!.itemIds.map((x) => moved.items[x]!.label)).toEqual(['b', 'c', 'a'])
  })

  it('works upwards as well as downwards', () => {
    const { board, id, tier } = scenario([], ['a', 'b', 'c'])
    const target = finalDrop(board, id('c'), id('a'))

    expect(target).toEqual({ zone: tier(0), index: 0 })
    const moved = moveItem(board, id('c'), target!.zone, target!.index)
    expect(moved.tiers[0]!.itemIds.map((x) => moved.items[x]!.label)).toEqual(['c', 'a', 'b'])
  })

  it('sends a tile dropped on the row’s empty space to the end', () => {
    const { board, id, tier } = scenario([], ['a', 'b', 'c'])
    const target = finalDrop(board, id('a'), tier(0))

    const moved = moveItem(board, id('a'), target!.zone, target!.index)
    expect(moved.tiers[0]!.itemIds.map((x) => moved.items[x]!.label)).toEqual(['b', 'c', 'a'])
  })

  it('keeps the previewed position when released over nothing', () => {
    const { board, id, tier } = scenario([], ['a', 'b', 'c'])
    expect(finalDrop(board, id('b'), null)).toEqual({ zone: tier(0), index: 1 })
  })

  it('keeps the previewed position when released over itself', () => {
    const { board, id, tier } = scenario([], ['a', 'b', 'c'])
    expect(finalDrop(board, id('b'), id('b'))).toEqual({ zone: tier(0), index: 1 })
  })

  it('does not move across zones — the preview already did that', () => {
    const { board, id, tier } = scenario(['a'], ['x'])
    // `board` here is the *preview* board, where the tile already crossed over.
    const previewed = moveItem(board, id('a'), tier(0), 0)
    expect(finalDrop(previewed, id('a'), id('x'))).toEqual({ zone: tier(0), index: 1 })
  })

  it('is stable: dropping a tile on itself never reorders anything', () => {
    const { board, id } = scenario([], ['a', 'b', 'c'])
    for (const label of ['a', 'b', 'c']) {
      const target = finalDrop(board, id(label), id(label))!
      const moved = moveItem(board, id(label), target.zone, target.index)
      expect(moved).toBe(board)
    }
  })

  it('returns null for a tile the board does not hold', () => {
    const { board } = scenario(['a'])
    expect(finalDrop(board, 'ghost', null)).toBeNull()
  })
})
