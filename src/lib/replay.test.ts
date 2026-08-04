import { describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem } from './board'
import { buildTimeline, frameAt, type CrowdReveal } from './replay'
import type { Board, Move } from '~/types'

const STEP = 400

function boardWith(count: number): Board {
  return addItems(
    createBoard({ title: 'Replay' }),
    Array.from({ length: count }, (_, index) => createItem(`Item ${index}`)),
  )
}

/** A move log that places every benched item into the top tier, in order. */
function movesFor(board: Board): Move[] {
  const tierId = board.tiers[0]!.id
  return board.bench.map((itemId, index) => ({
    at: index * STEP,
    itemId,
    from: 'bench',
    to: tierId,
    toIndex: index,
  }))
}

describe('buildTimeline', () => {
  it('starts from an empty board and ends on the finished one', () => {
    const board = boardWith(4)
    const moves = movesFor(board)
    const timeline = buildTimeline(board, moves, STEP)

    expect(timeline.states).toHaveLength(moves.length + 1)
    expect(timeline.states[0].tiers.every((tier) => tier.itemIds.length === 0)).toBe(true)
    expect(timeline.states.at(-1)?.tiers[0]?.itemIds).toHaveLength(4)
  })

  it('adds one state per move', () => {
    const board = boardWith(6)
    const timeline = buildTimeline(board, movesFor(board), STEP)

    timeline.states.forEach((state, index) => {
      expect(state.tiers[0]!.itemIds).toHaveLength(index)
    })
  })

  it('lasts the placements plus an outro', () => {
    const board = boardWith(5)
    const timeline = buildTimeline(board, movesFor(board), STEP)

    expect(timeline.placementMs).toBeGreaterThan(5 * STEP)
    expect(timeline.durationMs).toBe(timeline.placementMs)
  })

  it('handles a board with no moves at all', () => {
    const timeline = buildTimeline(boardWith(2), [], STEP)
    expect(timeline.states).toHaveLength(1)
    expect(timeline.moves).toEqual([])
  })
})

describe('frameAt', () => {
  const board = boardWith(4)
  const moves = movesFor(board)
  const timeline = buildTimeline(board, moves, STEP)

  it('shows nothing placed at time zero', () => {
    expect(frameAt(timeline, 0, STEP).board.tiers[0]!.itemIds).toHaveLength(0)
  })

  it('advances one placement per step', () => {
    expect(frameAt(timeline, STEP * 2.5, STEP).board.tiers[0]!.itemIds).toHaveLength(2)
  })

  it('pops the tile that just landed, then settles', () => {
    const justLanded = frameAt(timeline, STEP * 1.02, STEP)
    const settled = frameAt(timeline, STEP * 1.9, STEP)

    expect(justLanded.extras.highlight?.itemId).toBe(moves[0]!.itemId)
    expect(settled.extras.highlight).toBeUndefined()
  })

  it('never runs past the last state', () => {
    expect(frameAt(timeline, 999_999, STEP).board.tiers[0]!.itemIds).toHaveLength(4)
  })
})

describe('the crowd reveal', () => {
  const board = boardWith(3)
  const moves = movesFor(board)

  const reveal: CrowdReveal = {
    ghosts: new Map([[board.tiers[2]!.id, [{ itemId: board.bench[0]!, votes: 7, share: 0.7 }]]]),
    spotlight: board.bench[0]!,
  }

  it('extends the replay when there is one', () => {
    const plain = buildTimeline(board, moves, STEP)
    const withCrowd = buildTimeline(board, moves, STEP, reveal)

    expect(withCrowd.placementMs).toBe(plain.placementMs)
    expect(withCrowd.durationMs).toBeGreaterThan(plain.durationMs)
  })

  it('is ignored when the crowd agreed about everything', () => {
    const empty: CrowdReveal = { ghosts: new Map(), spotlight: null }
    const timeline = buildTimeline(board, moves, STEP, empty)

    expect(timeline.durationMs).toBe(timeline.placementMs)
    expect(timeline.crowd).toBeUndefined()
  })

  it('shows no ghosts while the placements are still running', () => {
    const timeline = buildTimeline(board, moves, STEP, reveal)
    expect(frameAt(timeline, STEP, STEP).extras.ghosts).toBeUndefined()
  })

  it('fades the ghosts in once the placements are done', () => {
    const timeline = buildTimeline(board, moves, STEP, reveal)

    const early = frameAt(timeline, timeline.placementMs + 10, STEP)
    const later = frameAt(timeline, timeline.placementMs + 600, STEP)

    expect(early.extras.ghosts).toBeDefined()
    expect(early.extras.ghostOpacity).toBeLessThan(later.extras.ghostOpacity ?? 0)
    expect(later.extras.ghostOpacity).toBeLessThanOrEqual(1)
  })

  it('holds the spotlight back until the layer is readable', () => {
    const timeline = buildTimeline(board, moves, STEP, reveal)

    expect(frameAt(timeline, timeline.placementMs + 10, STEP).extras.spotlight).toBeUndefined()
    expect(frameAt(timeline, timeline.durationMs - 10, STEP).extras.spotlight).toBe(
      reveal.spotlight,
    )
  })

  it('reveals over the finished board, not a partial one', () => {
    const timeline = buildTimeline(board, moves, STEP, reveal)
    const frame = frameAt(timeline, timeline.placementMs + 500, STEP)

    expect(frame.board.tiers[0]!.itemIds).toHaveLength(3)
  })
})
