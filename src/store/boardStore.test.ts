import { beforeEach, describe, expect, it } from 'vitest'
import { createBoard, createItem } from '~/lib/board'
import { BENCH } from '~/types'
import { useBoardStore } from './boardStore'

function reset() {
  useBoardStore.getState().replaceBoard(createBoard({ title: 'Test' }))
}

function seed(count: number): string[] {
  const items = Array.from({ length: count }, (_, index) => createItem(`item ${index}`))
  useBoardStore.getState().addItems(items)
  return items.map((item) => item.id)
}

describe('boardStore history', () => {
  beforeEach(reset)

  it('starts with nothing to undo', () => {
    expect(useBoardStore.getState().canUndo()).toBe(false)
    expect(useBoardStore.getState().canRedo()).toBe(false)
  })

  it('undoes and redoes a placement', () => {
    const [itemId] = seed(1)
    const tierId = useBoardStore.getState().board.tiers[0]!.id

    useBoardStore.getState().place(itemId!, tierId, 0)
    expect(useBoardStore.getState().board.tiers[0]!.itemIds).toEqual([itemId])

    useBoardStore.getState().undo()
    expect(useBoardStore.getState().board.tiers[0]!.itemIds).toEqual([])
    expect(useBoardStore.getState().board.bench).toEqual([itemId])

    useBoardStore.getState().redo()
    expect(useBoardStore.getState().board.tiers[0]!.itemIds).toEqual([itemId])
  })

  it('abandons the redo branch once a new edit lands', () => {
    const ids = seed(2)
    const tierId = useBoardStore.getState().board.tiers[0]!.id

    useBoardStore.getState().place(ids[0]!, tierId, 0)
    useBoardStore.getState().undo()
    expect(useBoardStore.getState().canRedo()).toBe(true)

    useBoardStore.getState().place(ids[1]!, tierId, 0)
    expect(useBoardStore.getState().canRedo()).toBe(false)
  })

  it('collapses consecutive title edits into one undo step', () => {
    useBoardStore.getState().setTitle('A')
    useBoardStore.getState().setTitle('AB')
    useBoardStore.getState().setTitle('ABC')

    useBoardStore.getState().undo()

    expect(useBoardStore.getState().board.title).toBe('Test')
  })

  it('keeps separate fields on separate undo steps', () => {
    useBoardStore.getState().setTitle('Title')
    useBoardStore.getState().setSubtitle('Subtitle')

    useBoardStore.getState().undo()

    expect(useBoardStore.getState().board.subtitle).toBe('')
    expect(useBoardStore.getState().board.title).toBe('Title')
  })
})

describe('boardStore replay log', () => {
  beforeEach(reset)

  it('records one move per placement', () => {
    const ids = seed(3)
    const tierId = useBoardStore.getState().board.tiers[0]!.id

    for (const id of ids) useBoardStore.getState().place(id, tierId, 0)

    const { moves } = useBoardStore.getState()
    expect(moves).toHaveLength(3)
    expect(moves[0]!.from).toBe(BENCH)
    expect(moves[0]!.to).toBe(tierId)
  })

  it('does not record a move that changes nothing', () => {
    const [itemId] = seed(1)

    useBoardStore.getState().place(itemId!, BENCH, 0)

    expect(useBoardStore.getState().moves).toHaveLength(0)
  })

  it('ignores placements of unknown items', () => {
    const tierId = useBoardStore.getState().board.tiers[0]!.id
    useBoardStore.getState().place('ghost', tierId, 0)

    expect(useBoardStore.getState().moves).toHaveLength(0)
  })

  it('rebuilds the log from a duel result so the replay shows the ranking landing', () => {
    const ids = seed(6)

    useBoardStore.getState().applyRanking(ids)

    const { moves, board } = useBoardStore.getState()
    expect(moves).toHaveLength(6)
    expect(board.bench).toEqual([])
    expect(new Set(moves.map((move) => move.itemId)).size).toBe(6)
  })

  it('clears the log when placements are reset', () => {
    const [itemId] = seed(1)
    const tierId = useBoardStore.getState().board.tiers[0]!.id
    useBoardStore.getState().place(itemId!, tierId, 0)

    useBoardStore.getState().clearPlacements()

    expect(useBoardStore.getState().moves).toEqual([])
  })
})

describe('boardStore tiers', () => {
  beforeEach(reset)

  it('recolours every tier when the palette changes', () => {
    useBoardStore.getState().setPalette('classic')

    const colors = useBoardStore.getState().board.tiers.map((tier) => tier.color)
    expect(colors[0]).toBe('#FF7F7F')
    expect(useBoardStore.getState().paletteId).toBe('classic')
  })

  it('reorders tiers', () => {
    const before = useBoardStore.getState().board.tiers.map((tier) => tier.label)

    useBoardStore.getState().reorderTier(0, 1)

    const after = useBoardStore.getState().board.tiers.map((tier) => tier.label)
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
  })
})
