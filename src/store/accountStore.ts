import { create } from 'zustand'
import * as api from '~/lib/api'

/**
 * What the server knows about you, mirrored in the app.
 *
 * Deliberately thin. The server is the authority on all of this — the store
 * caches answers so the interface does not flicker, and refetches rather than
 * trying to keep a local copy correct. Anything it believes is checked again
 * the next time it asks.
 *
 * `status` starts as `unknown` because "not signed in" and "have not looked
 * yet" are different states, and showing a sign-in button during the first is
 * right while showing it during the second is a flash of the wrong thing.
 */

export type SessionStatus = 'unknown' | 'checking' | 'anonymous' | 'signedIn' | 'unavailable'

interface AccountStore {
  status: SessionStatus
  account: api.Account | null
  boards: api.CloudBoard[]
  /** The cloud board the board being edited came from, when it came from one. */
  linkedId: string | null
  overlay: api.OverlayKey | null
  busy: boolean

  /** Asks the server who you are. Safe to call repeatedly. */
  refresh: () => Promise<void>
  refreshBoards: () => Promise<void>
  setLinked: (id: string | null) => void
  setOverlay: (overlay: api.OverlayKey | null) => void
  setBusy: (busy: boolean) => void
  /** Forgets everything cached about the session, without calling the server. */
  clear: () => void
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  status: api.configured ? 'unknown' : 'unavailable',
  account: null,
  boards: [],
  linkedId: null,
  overlay: null,
  busy: false,

  refresh: async () => {
    if (!api.configured) {
      set({ status: 'unavailable' })
      return
    }
    if (get().status === 'checking') return

    set({ status: 'checking' })
    try {
      const account = await api.me()
      set(
        account
          ? { status: 'signedIn', account }
          : { status: 'anonymous', account: null, boards: [], linkedId: null, overlay: null },
      )
    } catch {
      // A server that is configured but unreachable is not the same as no
      // server: the app still works, and the account panel says so rather than
      // pretending nobody is signed in.
      set({ status: 'unavailable', account: null })
    }
  },

  refreshBoards: async () => {
    if (get().status !== 'signedIn') return
    try {
      set({ boards: await api.listBoards() })
    } catch {
      set({ boards: [] })
    }
  },

  setLinked: (linkedId) => {
    set({ linkedId })
  },
  setOverlay: (overlay) => {
    set({ overlay })
  },
  setBusy: (busy) => {
    set({ busy })
  },
  clear: () => {
    set({
      status: api.configured ? 'anonymous' : 'unavailable',
      account: null,
      boards: [],
      linkedId: null,
      overlay: null,
    })
  },
}))

/** True when there is a server and this visitor is signed in to it. */
export function selectSignedIn(state: AccountStore): boolean {
  return state.status === 'signedIn'
}
