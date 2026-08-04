import { create } from 'zustand'
import {
  addItems,
  addTier,
  applyPalette,
  createBoard,
  distributeRanking,
  moveItem,
  moveTier,
  removeItem,
  removeTier,
  renameItem,
  resetPlacements,
  shuffleBench,
  updateTier,
  zoneOf,
} from '~/lib/board'
import { DEFAULT_PALETTE, paletteById, type Palette } from '~/lib/palette'
import {
  BENCH,
  type Board,
  type Item,
  type ItemId,
  type Move,
  type Tier,
  type TierId,
  type ZoneId,
} from '~/types'

const HISTORY_LIMIT = 60
/** Consecutive edits of the same field inside this window collapse into one undo step. */
const COALESCE_MS = 700

interface CommitOptions {
  /** Same key twice in a row within COALESCE_MS replaces the previous step. */
  coalesce?: string
  /** Placement change to append to the replay log. */
  record?: Move
}

export interface BoardStore {
  board: Board
  moves: Move[]
  paletteId: string
  past: Board[]
  future: Board[]
  /** Wall-clock start of the session, used for replay timestamps. */
  startedAt: number
  lastCoalesce: { key: string; at: number } | null

  replaceBoard: (board: Board, options?: { keepMoves?: boolean }) => void
  newBoard: () => void

  place: (itemId: ItemId, toZone: ZoneId, toIndex: number) => void
  addItems: (items: readonly Item[]) => void
  removeItem: (itemId: ItemId) => void
  renameItem: (itemId: ItemId, label: string) => void

  setTitle: (title: string) => void
  setSubtitle: (subtitle: string) => void

  addTier: (atIndex: number) => void
  removeTier: (tierId: TierId) => void
  updateTier: (tierId: TierId, patch: Partial<Omit<Tier, 'id'>>) => void
  reorderTier: (fromIndex: number, toIndex: number) => void
  setPalette: (paletteId: string) => void

  clearPlacements: () => void
  shuffle: () => void
  applyRanking: (orderedIds: readonly ItemId[], weights?: readonly number[]) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

function palette(state: { paletteId: string }): Palette {
  return paletteById(state.paletteId)
}

export const useBoardStore = create<BoardStore>()((set, get) => {
  /**
   * Single write path. Every mutation goes through here so undo, the replay log
   * and the redo invalidation can never drift apart.
   */
  const commit = (next: Board, options: CommitOptions = {}): void => {
    const state = get()
    if (next === state.board) return

    const now = Date.now()
    const coalescing =
      options.coalesce !== undefined &&
      state.lastCoalesce?.key === options.coalesce &&
      now - state.lastCoalesce.at < COALESCE_MS

    set({
      board: next,
      past: coalescing ? state.past : [...state.past, state.board].slice(-HISTORY_LIMIT),
      // Any new edit abandons the redo branch, as in every editor.
      future: [],
      lastCoalesce: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null,
      moves: options.record ? [...state.moves, options.record] : state.moves,
    })
  }

  return {
    board: createBoard(),
    moves: [],
    paletteId: DEFAULT_PALETTE.id,
    past: [],
    future: [],
    startedAt: Date.now(),
    lastCoalesce: null,

    replaceBoard: (board, options = {}) => {
      set({
        board,
        past: [],
        future: [],
        lastCoalesce: null,
        startedAt: Date.now(),
        moves: options.keepMoves ? get().moves : [],
      })
    },

    newBoard: () => {
      get().replaceBoard(createBoard({ palette: palette(get()) }))
    },

    place: (itemId, toZone, toIndex) => {
      const state = get()
      const from = zoneOf(state.board, itemId)
      if (from === null) return

      const next = moveItem(state.board, itemId, toZone, toIndex)
      if (next === state.board) return

      commit(next, {
        record: { at: Date.now() - state.startedAt, itemId, from, to: toZone, toIndex },
      })
    },

    addItems: (items) => {
      commit(addItems(get().board, items))
    },
    removeItem: (itemId) => {
      commit(removeItem(get().board, itemId))
    },
    renameItem: (itemId, label) => {
      commit(renameItem(get().board, itemId, label), { coalesce: `item:${itemId}` })
    },

    setTitle: (title) => {
      commit({ ...get().board, title, updatedAt: Date.now() }, { coalesce: 'title' })
    },
    setSubtitle: (subtitle) => {
      commit({ ...get().board, subtitle, updatedAt: Date.now() }, { coalesce: 'subtitle' })
    },

    addTier: (atIndex) => {
      commit(addTier(get().board, atIndex, palette(get())))
    },
    removeTier: (tierId) => {
      commit(removeTier(get().board, tierId))
    },
    updateTier: (tierId, patch) => {
      commit(updateTier(get().board, tierId, patch), { coalesce: `tier:${tierId}` })
    },
    reorderTier: (fromIndex, toIndex) => {
      commit(moveTier(get().board, fromIndex, toIndex))
    },
    setPalette: (paletteId) => {
      set({ paletteId })
      commit(applyPalette(get().board, paletteById(paletteId)))
    },

    clearPlacements: () => {
      commit(resetPlacements(get().board))
      set({ moves: [] })
    },
    shuffle: () => {
      commit(shuffleBench(get().board))
    },
    applyRanking: (orderedIds, weights) => {
      const state = get()
      const next = distributeRanking(state.board, orderedIds, weights)
      if (next === state.board) return

      // A duel run replaces every placement at once; rebuild the replay log so the
      // exported video shows the ranking landing tier by tier.
      const moves: Move[] = []
      next.tiers.forEach((tier) => {
        tier.itemIds.forEach((itemId, index) => {
          moves.push({ at: moves.length * 400, itemId, from: BENCH, to: tier.id, toIndex: index })
        })
      })

      set({
        board: next,
        past: [...state.past, state.board].slice(-HISTORY_LIMIT),
        future: [],
        lastCoalesce: null,
        moves,
      })
    },

    undo: () => {
      const state = get()
      const previous = state.past.at(-1)
      if (!previous) return

      set({
        board: previous,
        past: state.past.slice(0, -1),
        future: [state.board, ...state.future].slice(0, HISTORY_LIMIT),
        lastCoalesce: null,
      })
    },
    redo: () => {
      const state = get()
      const [next, ...rest] = state.future
      if (!next) return

      set({
        board: next,
        past: [...state.past, state.board].slice(-HISTORY_LIMIT),
        future: rest,
        lastCoalesce: null,
      })
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }
})
