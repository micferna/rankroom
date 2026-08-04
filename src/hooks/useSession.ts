import { useEffect, useRef, useState } from 'react'
import { clearHash } from '~/app/route'
import { BoardParseError } from '~/lib/schema'
import { decodeBoard } from '~/lib/share'
import { loadAutosave, saveAutosave } from '~/lib/storage'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'

const AUTOSAVE_DEBOUNCE_MS = 900

/**
 * Restores the session, then keeps it saved.
 *
 * Precedence is deliberate: a share token in the URL always wins over the
 * autosave, because someone who opened a link expects to see that board — but
 * the autosave is only overwritten once they change something, so the previous
 * session is still recoverable until then.
 */
export function useSession(shareToken: string | null): { restoring: boolean } {
  const replaceBoard = useBoardStore((state) => state.replaceBoard)
  const notify = useUiStore((state) => state.notify)
  const [restoring, setRestoring] = useState(true)
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true

    const run = async () => {
      if (shareToken) {
        try {
          replaceBoard(await decodeBoard(shareToken))
          clearHash()
          notify('Opened the shared board. It is yours to edit now.', 'good')
          return
        } catch (error) {
          notify(
            error instanceof BoardParseError
              ? error.message
              : 'That share link could not be opened.',
            'bad',
          )
          clearHash()
        }
      }

      try {
        const saved = await loadAutosave()
        if (saved) replaceBoard(saved.board, { keepMoves: false })
      } catch {
        // A corrupt or blocked database should not stop the app from starting.
      }
    }

    void run().finally(() => {
      setRestoring(false)
    })
  }, [shareToken, replaceBoard, notify])

  // Autosave: subscribe outside React so typing does not re-render on every keystroke.
  useEffect(() => {
    let timer: number | undefined

    const unsubscribe = useBoardStore.subscribe((state, previous) => {
      if (state.board === previous.board && state.moves === previous.moves) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void saveAutosave(useBoardStore.getState().board, useBoardStore.getState().moves)
      }, AUTOSAVE_DEBOUNCE_MS)
    })

    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  return { restoring }
}
