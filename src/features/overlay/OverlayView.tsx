import { useEffect, useState } from 'react'
import { GhostTile, TileFace } from '~/components/board/Tile'
import { useT } from '~/i18n'
import { createChannel } from '~/lib/channel'
import { crowdGhosts } from '~/lib/crowd'
import { errorKey } from '~/lib/errors'
import { selectTally, useCrowdStore } from '~/store/crowdStore'
import { cx } from '~/lib/cx'
import { readableInk, tint } from '~/lib/palette'
import { decodeBoard } from '~/lib/share'
import type { Board, ItemId, TierId } from '~/types'

interface OverlayViewProps {
  /** When present the board is read from the URL instead of the live channel. */
  token: string | null
}

/**
 * The view OBS composites over the video.
 *
 * The page background is transparent — set the Browser Source to no custom CSS
 * and it keys straight over the scene. Everything is drawn with a hard shadow so
 * it stays readable over bright footage.
 */
export function OverlayView({ token }: OverlayViewProps) {
  const t = useT()
  const [board, setBoard] = useState<Board | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ itemId: ItemId | null; tierId: TierId | null }>({
    itemId: null,
    tierId: null,
  })
  const [live, setLive] = useState(true)

  // The crowd layer travels with the studio window, so viewers watching the
  // stream can see their own votes land next to the streamer's choices.
  const votes = useCrowdStore((state) => state.votes)
  const windowMs = useCrowdStore((state) => state.config.windowMs)
  const showGhosts = useCrowdStore((state) => state.showGhosts)

  useEffect(() => {
    document.body.dataset.surface = 'overlay'
    return () => {
      delete document.body.dataset.surface
    }
  }, [])

  useEffect(() => {
    if (!token) return

    decodeBoard(token)
      .then(setBoard)
      .catch((cause: unknown) => {
        setErrorMessage(t(errorKey(cause, 'overlay.unreadable')))
      })
  }, [token, t])

  useEffect(() => {
    if (token) return

    const channel = createChannel((message) => {
      if (message.type === 'board') setBoard(message.board)
      if (message.type === 'reveal') setReveal({ itemId: message.itemId, tierId: message.tierId })
      if (message.type === 'live') setLive(message.live)
    })

    // Ask whoever is driving to send the current state; a source can be added mid-show.
    channel.post({ type: 'hello' })
    return channel.close
  }, [token])

  if (errorMessage) {
    return (
      <p className="m-6 rounded-control bg-program/90 px-4 py-3 text-sm text-white">
        {errorMessage}
      </p>
    )
  }

  const ghosts =
    board && showGhosts && votes.size > 0
      ? crowdGhosts(selectTally(votes, board, windowMs), board)
      : null

  if (!board) {
    return (
      <p className="m-6 rounded-control bg-room/80 px-4 py-3 text-sm text-chalk">
        {t('overlay.waiting')}
      </p>
    )
  }

  return (
    <div
      className={cx(
        'flex min-h-dvh flex-col justify-end gap-1 p-3 transition-opacity duration-500',
        live ? 'opacity-100' : 'opacity-0',
      )}
      style={{ filter: 'drop-shadow(0 3px 10px rgb(0 0 0 / 0.65))' }}
    >
      <h1 className="type-display px-1 text-2xl text-white">{board.title}</h1>

      {board.tiers.map((tier) => {
        const cued = reveal.tierId === tier.id
        return (
          <div key={tier.id} className="flex items-stretch gap-1.5">
            <div
              className={cx(
                'grid w-16 shrink-0 place-items-center rounded-tile transition-transform duration-300',
                cued && 'scale-105',
              )}
              style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
            >
              <span className="type-display text-xl">{tier.label}</span>
            </div>

            <div
              className={cx(
                'flex flex-1 flex-wrap content-start gap-1.5 rounded-tile p-1.5 transition-colors duration-300',
                cued && 'ring-2 ring-white/70',
              )}
              style={{ backgroundColor: tint(tier.color, 0.18) }}
            >
              {tier.itemIds.map((itemId) => {
                const item = board.items[itemId]
                if (!item) return null
                return (
                  <div key={itemId} className={cx(reveal.itemId === itemId && 'animate-land')}>
                    <TileFace item={item} size={52} showLabel={false} />
                  </div>
                )
              })}

              {ghosts?.get(tier.id)?.map((placement) => {
                const item = board.items[placement.itemId]
                if (!item) return null
                return (
                  <GhostTile
                    key={`ghost-${placement.itemId}`}
                    item={item}
                    size={52}
                    votes={placement.votes}
                    share={placement.share}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
