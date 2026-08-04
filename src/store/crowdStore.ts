import { create } from 'zustand'
import {
  castVote,
  DEFAULT_CROWD_CONFIG,
  isBlocked,
  voteWeight,
  parseVote,
  pruneVotes,
  tallyVotes,
  type CrowdConfig,
  type CrowdTally,
  type CrowdVote,
} from '~/lib/crowd'
import { preferences } from '~/lib/storage'
import {
  connectTwitchChat,
  type ChatConnection,
  type ChatRoles,
  type ChatStatus,
} from '~/lib/twitch'
import type { Board, ItemId } from '~/types'
import { useBoardStore } from './boardStore'

/** Recent chat lines, for the on-screen feed. Bounded so a busy chat cannot grow it. */
const FEED_LIMIT = 40

export interface FeedEntry {
  id: number
  display: string
  text: string
  /** True when the line was read as a vote. */
  counted: boolean
}

interface CrowdStore {
  channel: string
  status: ChatStatus
  config: CrowdConfig
  votes: Map<string, CrowdVote>
  feed: FeedEntry[]
  /** Item chat is voting on in deck mode. */
  deckItemId: ItemId | null
  /** Whether the ghost layer is drawn on the board and the overlay. */
  showGhosts: boolean

  connect: (channel: string) => void
  disconnect: () => void
  setConfig: (patch: Partial<CrowdConfig>) => void
  setDeckItem: (itemId: ItemId | null) => void
  setShowGhosts: (show: boolean) => void
  clearVotes: () => void
  /** Test seam: feed a chat line without a socket. */
  ingest: (user: string, display: string, text: string, roles?: ChatRoles) => void
}

// The socket lives outside React state: it is not rendered, and it must survive
// re-renders and mode changes without reconnecting.
const NO_ROLES: ChatRoles = {
  subscriber: false,
  moderator: false,
  vip: false,
  broadcaster: false,
}

let connection: ChatConnection | null = null
let feedId = 0

export const useCrowdStore = create<CrowdStore>()((set, get) => ({
  channel: preferences.read<string>('crowd.channel', ''),
  status: 'idle',
  config: {
    ...DEFAULT_CROWD_CONFIG,
    ...preferences.read<Partial<CrowdConfig>>('crowd.config', {}),
  },
  votes: new Map(),
  feed: [],
  deckItemId: null,
  showGhosts: true,

  connect: (channel) => {
    connection?.close()
    preferences.write('crowd.channel', channel)
    set({ channel, feed: [] })

    connection = connectTwitchChat(channel, {
      onStatus: (status) => {
        set({ status })
      },
      onMessage: (message) => {
        get().ingest(message.user, message.display, message.text, message.roles)
      },
    })
  },

  disconnect: () => {
    connection?.close()
    connection = null
    set({ status: 'idle' })
  },

  setConfig: (patch) => {
    const config = { ...get().config, ...patch }
    preferences.write('crowd.config', config)
    set({ config })
  },

  setDeckItem: (deckItemId) => {
    set({ deckItemId })
  },
  setShowGhosts: (showGhosts) => {
    set({ showGhosts })
  },
  clearVotes: () => {
    set({ votes: new Map() })
  },

  ingest: (user, display, text, roles = NO_ROLES) => {
    const state = get()
    const board = useBoardStore.getState().board

    if (isBlocked(user, state.config)) return

    const parsed = parseVote(text, {
      board,
      config: state.config,
      deckItemId: state.deckItemId,
    })

    const entry: FeedEntry = {
      id: (feedId += 1),
      display,
      text: text.slice(0, 140),
      counted: parsed !== null,
    }
    const feed = [entry, ...state.feed].slice(0, FEED_LIMIT)

    if (!parsed) {
      set({ feed })
      return
    }

    const weight = voteWeight(roles, state.config)
    // A zero weight means "not allowed to vote here": the line is shown in the
    // feed but does not count, which is far less confusing than dropping it.
    if (weight <= 0) {
      set({ feed: [{ ...entry, counted: false }, ...state.feed.slice(1)] })
      return
    }

    const vote: CrowdVote = { user, display, at: Date.now(), weight, ...parsed }
    set({ feed, votes: castVote(state.votes, vote) })
  },
}))

/** Live tally against the current board, with stale and orphaned votes dropped. */
export function selectTally(
  votes: Map<string, CrowdVote>,
  board: Board,
  windowMs: number,
  minVotes = 1,
): CrowdTally {
  return tallyVotes(pruneVotes(votes, board, windowMs, Date.now()), board, minVotes)
}
