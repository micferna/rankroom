import { describe, expect, it } from 'vitest'
import { addItems, addTier, createBoard, createItem, moveItem, removeTier } from './board'
import { DEFAULT_PALETTE } from './palette'
import { compareBoards } from './compare'
import type { Board } from '~/types'

/** Builds a board with exactly `rows.length` tiers, holding those labels. */
function boardOf(rows: string[][]): Board {
  let board = createBoard()
  while (board.tiers.length > rows.length) board = removeTier(board, board.tiers[0]!.id)
  while (board.tiers.length < rows.length) board = addTier(board, 0, DEFAULT_PALETTE)

  board = addItems(
    board,
    rows.flat().map((label) => createItem(label)),
  )

  rows.forEach((labels, tierIndex) => {
    for (const label of labels) {
      const item = Object.values(board.items).find((candidate) => candidate.label === label)
      if (item) board = moveItem(board, item.id, board.tiers[tierIndex]!.id, 0)
    }
  })

  return board
}

describe('compareBoards', () => {
  it('scores identical rankings as full agreement', () => {
    const rows = [['a'], ['b'], ['c']]
    const result = compareBoards(boardOf(rows), boardOf(rows))

    expect(result.agreement).toBe(1)
    expect(result.exactMatches).toBe(3)
    expect(result.hotTakes).toEqual([])
  })

  it('scores opposite rankings near zero', () => {
    const left = boardOf([['a'], [], [], [], [], ['b']])
    const right = boardOf([['b'], [], [], [], [], ['a']])

    expect(compareBoards(left, right).agreement).toBe(0)
  })

  it('matches items by name when the boards were built separately', () => {
    const result = compareBoards(boardOf([['Juno 106']]), boardOf([['juno-106']]))

    expect(result.shared).toBe(1)
    expect(result.onlyLeft).toBe(0)
    expect(result.onlyRight).toBe(0)
  })

  it('counts items that exist on only one side', () => {
    const result = compareBoards(boardOf([['a', 'b']]), boardOf([['a', 'c']]))

    expect(result.shared).toBe(1)
    expect(result.onlyLeft).toBe(1)
    expect(result.onlyRight).toBe(1)
  })

  it('normalises across different tier counts', () => {
    // Bottom tier of a 3-tier board and bottom tier of a 6-tier board agree.
    const left = boardOf([[], [], ['a']])
    const right = boardOf([[], [], [], [], [], ['a']])

    expect(compareBoards(left, right).agreement).toBe(1)
  })

  it('ranks the biggest disagreements first', () => {
    const left = boardOf([['a', 'b'], [], ['c']])
    const right = boardOf([['a'], ['b'], ['c']])
    const result = compareBoards(left, right)

    expect(result.hotTakes[0]?.label).toBe('b')
  })

  it('reports zero agreement when nothing is comparable', () => {
    const result = compareBoards(boardOf([['a']]), boardOf([['b']]))

    expect(result.measured).toBe(0)
    expect(result.agreement).toBe(0)
  })

  it('lists benched items without a gap', () => {
    const withBench = addItems(boardOf([['a']]), [createItem('unranked')])
    const result = compareBoards(withBench, boardOf([['a']]))

    const row = result.rows.find((entry) => entry.label === 'unranked')
    expect(row?.left).toBeNull()
    expect(row?.gap).toBeNull()
  })
})
