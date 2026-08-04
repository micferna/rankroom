import { describe, expect, it } from 'vitest'
import {
  answerDuel,
  canUndoDuel,
  duelPair,
  duelProgress,
  estimatedComparisons,
  isDuelComplete,
  parkCurrent,
  remainingComparisons,
  startDuel,
  undoDuel,
  type DuelState,
} from './duel'

const sequential = () => 0.5

/**
 * Drives a full run using a known "true" order: the winner is whichever id
 * appears earlier in `truth`. If binary insertion is correct, the result must
 * come back in exactly that order.
 */
function runToCompletion(ids: string[], truth: string[]): DuelState {
  let state = startDuel(ids, sequential)
  let guard = 0

  while (!isDuelComplete(state)) {
    const pair = duelPair(state)
    if (!pair) break

    guard += 1
    if (guard > 10_000) throw new Error('Duel run did not converge')

    const leftWins = truth.indexOf(pair.left) < truth.indexOf(pair.right)
    state = answerDuel(state, leftWins ? 'left' : 'right')
  }

  return state
}

describe('startDuel', () => {
  it('handles an empty pool', () => {
    const state = startDuel([], sequential)
    expect(isDuelComplete(state)).toBe(true)
    expect(state.ranked).toEqual([])
  })

  it('completes immediately with a single item', () => {
    const state = startDuel(['a'], sequential)
    expect(isDuelComplete(state)).toBe(true)
    expect(state.ranked).toEqual(['a'])
  })
})

describe('answerDuel', () => {
  it('produces the true order for a consistent judge', () => {
    const truth = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const state = runToCompletion([...truth].reverse(), truth)

    expect(state.ranked).toEqual(truth)
  })

  it('scales like n log n, not n squared', () => {
    const truth = Array.from({ length: 32 }, (_, index) => `item-${String(index).padStart(2, '0')}`)
    const state = runToCompletion([...truth].reverse(), truth)

    expect(state.ranked).toEqual(truth)
    // A round robin would need 496 comparisons for 32 items.
    expect(state.comparisons).toBeLessThanOrEqual(estimatedComparisons(32))
    expect(state.comparisons).toBeLessThan(200)
  })

  it('places a tie directly below its rival and stops asking', () => {
    let state = startDuel(['a', 'b'], sequential)
    const before = state.comparisons

    state = answerDuel(state, 'tie')

    expect(state.comparisons).toBe(before + 1)
    expect(isDuelComplete(state)).toBe(true)
    expect(state.ranked).toHaveLength(2)
  })

  it('is a no-op once the run is complete', () => {
    const state = startDuel(['a'], sequential)
    expect(answerDuel(state, 'left')).toBe(state)
  })
})

describe('parkCurrent', () => {
  it('sets the item aside without ranking it', () => {
    let state = startDuel(['a', 'b', 'c'], sequential)
    const parked = state.current!

    state = parkCurrent(state)

    expect(state.parked).toContain(parked)
    expect(state.ranked).not.toContain(parked)
  })
})

describe('undoDuel', () => {
  it('restores the previous question', () => {
    const start = startDuel(['a', 'b', 'c', 'd'], sequential)
    const after = answerDuel(start, 'left')

    expect(canUndoDuel(after)).toBe(true)

    const back = undoDuel(after)
    expect(back.comparisons).toBe(start.comparisons)
    expect(back.ranked).toEqual(start.ranked)
    expect(duelPair(back)).toEqual(duelPair(start))
  })

  it('is a no-op at the start of a run', () => {
    const state = startDuel(['a', 'b'], sequential)
    expect(canUndoDuel(state)).toBe(false)
    expect(undoDuel(state)).toBe(state)
  })
})

describe('progress reporting', () => {
  it('runs from 0 to 1 and never exceeds it', () => {
    const truth = ['a', 'b', 'c', 'd', 'e']
    let state = startDuel([...truth], sequential)
    expect(duelProgress(state)).toBeGreaterThan(0)

    while (!isDuelComplete(state)) {
      const pair = duelPair(state)
      if (!pair) break
      expect(duelProgress(state)).toBeLessThanOrEqual(1)
      state = answerDuel(state, 'left')
    }

    expect(duelProgress(state)).toBe(1)
    expect(remainingComparisons(state)).toBe(0)
  })

  it('reports an empty pool as finished', () => {
    expect(duelProgress(startDuel([], sequential))).toBe(1)
  })
})
