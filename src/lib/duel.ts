import { shuffle } from './board'
import type { ItemId } from '~/types'

/**
 * Duel mode ranks a bench by asking one question at a time: "which of these two
 * is better?". Under the hood it is a binary insertion sort — each new item is
 * placed with ~log2(k) comparisons instead of the k a linear scan would need,
 * so 50 items take roughly 200 duels rather than 1,225.
 *
 * The whole thing is a pure state machine: no promises, no callbacks. That makes
 * every step undoable and the engine testable without a DOM.
 */

export type DuelVerdict = 'left' | 'right' | 'tie'

export interface DuelState {
  /** Ranked so far, best first. */
  ranked: readonly ItemId[]
  /** Still waiting for their first duel. */
  queue: readonly ItemId[]
  /** Items the user chose not to rank; they go back to the bench. */
  parked: readonly ItemId[]
  /** The item currently being placed, or null once everything is ranked. */
  current: ItemId | null
  /** Binary-search window into `ranked` for `current`. */
  lo: number
  hi: number
  comparisons: number
  history: readonly DuelState[]
}

/** The two items to show. `left` is always the newcomer. */
export interface DuelPair {
  left: ItemId
  right: ItemId
}

const MAX_HISTORY = 200

export function startDuel(
  itemIds: readonly ItemId[],
  random: () => number = Math.random,
): DuelState {
  // Presentation order is randomised so the bench order does not bias the result.
  const pool = shuffle(itemIds, random)
  const [first, ...rest] = pool

  return {
    ranked: first ? [first] : [],
    queue: rest,
    parked: [],
    current: rest[0] ?? null,
    lo: 0,
    hi: first ? 1 : 0,
    comparisons: 0,
    history: [],
  }
}

export function isDuelComplete(state: DuelState): boolean {
  return state.current === null
}

/** The duel to show right now, or null when the run is finished. */
export function duelPair(state: DuelState): DuelPair | null {
  if (state.current === null || state.lo >= state.hi) return null
  const right = state.ranked[midpoint(state)]
  if (right === undefined) return null
  return { left: state.current, right }
}

function midpoint(state: DuelState): number {
  return Math.floor((state.lo + state.hi) / 2)
}

function remember(state: DuelState): readonly DuelState[] {
  const entry: DuelState = { ...state, history: [] }
  return [...state.history.slice(-(MAX_HISTORY - 1)), entry]
}

/** Advances to the next item once the current one has found its slot. */
function place(state: DuelState, at: number): DuelState {
  const current = state.current
  if (current === null) return state

  const ranked = [...state.ranked]
  ranked.splice(Math.max(0, Math.min(at, ranked.length)), 0, current)

  const queue = state.queue.slice(1)
  const next = queue[0] ?? null

  return {
    ...state,
    ranked,
    queue,
    current: next,
    lo: 0,
    hi: next === null ? 0 : ranked.length,
  }
}

export function answerDuel(state: DuelState, verdict: DuelVerdict): DuelState {
  const pair = duelPair(state)
  if (!pair) return state

  const history = remember(state)
  const mid = midpoint(state)
  const comparisons = state.comparisons + 1

  if (verdict === 'tie') {
    // A tie means "about the same": drop the newcomer directly below its rival
    // and stop asking. Ties are how a creator says the exact order is noise.
    return { ...place({ ...state, comparisons }, mid + 1), history }
  }

  const lo = verdict === 'left' ? state.lo : mid + 1
  const hi = verdict === 'left' ? mid : state.hi
  const next: DuelState = { ...state, lo, hi, comparisons }

  return lo >= hi ? { ...place(next, lo), history } : { ...next, history }
}

/** Sets the current item aside; it comes back to the bench unranked. */
export function parkCurrent(state: DuelState): DuelState {
  if (state.current === null) return state

  const history = remember(state)
  const queue = state.queue.slice(1)
  const next = queue[0] ?? null

  return {
    ...state,
    parked: [...state.parked, state.current],
    queue,
    current: next,
    lo: 0,
    hi: next === null ? 0 : state.ranked.length,
    history,
  }
}

export function undoDuel(state: DuelState): DuelState {
  const previous = state.history.at(-1)
  if (!previous) return state
  return { ...previous, history: state.history.slice(0, -1) }
}

export function canUndoDuel(state: DuelState): boolean {
  return state.history.length > 0
}

/** Comparisons a binary insertion sort needs for `n` items, worst case. */
export function estimatedComparisons(n: number): number {
  let total = 0
  for (let k = 1; k < n; k += 1) total += Math.ceil(Math.log2(k + 1))
  return total
}

/** 0–1, based on items placed rather than duels answered, which is what the user feels. */
export function duelProgress(state: DuelState): number {
  const total = state.ranked.length + state.queue.length + state.parked.length
  if (total === 0) return 1
  return (state.ranked.length + state.parked.length) / total
}

/** Duels still expected before the run ends, worst case. */
export function remainingComparisons(state: DuelState): number {
  if (state.current === null) return 0

  let total = Math.max(0, Math.ceil(Math.log2(Math.max(1, state.hi - state.lo + 1))))
  for (let k = state.ranked.length + 1; k <= state.ranked.length + state.queue.length; k += 1) {
    total += Math.ceil(Math.log2(k + 1))
  }
  return total
}
