import { useEffect, useRef, useState } from 'react'
import { clearHash } from '~/app/route'
import { useT } from '~/i18n'
import { errorKey } from '~/lib/errors'
import { decodeBoard, isBlindBoard, withoutBlindMarker } from '~/lib/share'
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
  const t = useT()
  const replaceBoard = useBoardStore((state) => state.replaceBoard)
  const setBlindChallenge = useBoardStore((state) => state.setBlindChallenge)
  const notify = useUiStore((state) => state.notify)
  const [restoring, setRestoring] = useState(true)
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true

    const run = async () => {
      if (shareToken) {
        try {
          const opened = await decodeBoard(shareToken)

          if (isBlindBoard(opened)) {
            // A blind link invites you to rank the same tiles without seeing the
            // sender's answer, so their board is kept aside for the comparison
            // instead of being shown.
            setBlindChallenge(shareToken)
            replaceBoard(withoutBlindMarker(opened))
            clearHash()
            notify(t('session.blindOpened'), 'good')
            return
          }

          replaceBoard(opened)
          clearHash()
          notify(t('session.shareOpened'), 'good')
          return
        } catch (error) {
          notify(t(errorKey(error, 'session.shareFailed')), 'bad')
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
  }, [shareToken, replaceBoard, setBlindChallenge, notify, t])

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
