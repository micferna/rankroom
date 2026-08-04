import { create } from 'zustand'
import {
  answerDuel,
  canUndoDuel,
  isDuelComplete,
  parkCurrent,
  startDuel,
  undoDuel,
  type DuelState,
  type DuelVerdict,
} from '~/lib/duel'
import type { Board, ItemId } from '~/types'

/**
 * A duel run outlives the Duel tab.
 *
 * The state used to live in the component, so glancing at the board mid-run
 * unmounted it and threw away every answer — brutal forty duels in. It lives
 * here instead, and only the board it was started on can claim it.
 */
interface DuelStore {
  run: DuelState | null
  /** The board this run belongs to; a different board invalidates it. */
  boardId: string | null

  start: (itemIds: readonly ItemId[], boardId: string) => void
  answer: (verdict: DuelVerdict) => void
  park: () => void
  undo: () => void
  reset: () => void
}

export const useDuelStore = create<DuelStore>()((set, get) => ({
  run: null,
  boardId: null,

  start: (itemIds, boardId) => {
    set({ run: startDuel(itemIds), boardId })
  },
  answer: (verdict) => {
    const { run } = get()
    if (run) set({ run: answerDuel(run, verdict) })
  },
  park: () => {
    const { run } = get()
    if (run) set({ run: parkCurrent(run) })
  },
  undo: () => {
    const { run } = get()
    if (run && canUndoDuel(run)) set({ run: undoDuel(run) })
  },
  reset: () => {
    set({ run: null, boardId: null })
  },
}))

/**
 * The run to show for this board, or null.
 *
 * A run is dropped when the board changed underneath it — a new board, a
 * template, a shared link — because its ranking would refer to items that no
 * longer exist. Items merely *removed* mid-run are handled at placement time,
 * where unknown ids are ignored.
 */
export function activeRun(
  run: DuelState | null,
  runBoardId: string | null,
  board: Board,
): DuelState | null {
  if (!run || runBoardId !== board.id) return null
  if (isDuelComplete(run) && run.ranked.length === 0) return null
  return run
}
