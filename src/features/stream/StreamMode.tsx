import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { overlayUrl } from '~/app/route'
import { TileFace } from '~/components/board/Tile'
import { Button, IconButton } from '~/components/ui/Button'
import { useT } from '~/i18n'
import { useHotkeys } from '~/hooks/useHotkeys'
import { stageTileSize, useViewport } from '~/hooks/useViewport'
import { itemsIn } from '~/lib/board'
import { createChannel, type RankRoomChannel } from '~/lib/channel'
import { copyText } from '~/lib/download'
import { cx } from '~/lib/cx'
import { readableInk, tint } from '~/lib/palette'
import { encodeBoard } from '~/lib/share'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { ItemId, TierId } from '~/types'

/**
 * Stream mode is the on-camera surface: one tile on deck at a time, placed with
 * a number key, mirrored to the overlay as it happens. It is a presenter view,
 * not another editor — the only actions are place, skip and undo.
 */
export function StreamMode() {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const place = useBoardStore((state) => state.place)
  const undo = useBoardStore((state) => state.undo)
  const canUndo = useBoardStore((state) => state.canUndo)

  const live = useUiStore((state) => state.live)
  const setLive = useUiStore((state) => state.setLive)
  const notify = useUiStore((state) => state.notify)

  const deckSize = stageTileSize(useViewport(), 0.26, 260)
  const channelRef = useRef<RankRoomChannel | null>(null)
  const [cuedTier, setCuedTier] = useState<TierId | null>(null)
  const [justPlaced, setJustPlaced] = useState<ItemId | null>(null)

  const onDeck = board.bench[0]
  const deckItem = onDeck ? board.items[onDeck] : undefined
  const upNext = useMemo(() => itemsIn(board, board.bench.slice(1, 6)), [board])

  useEffect(() => {
    const channel = createChannel((message) => {
      // A Browser Source that joins late asks for the current state.
      if (message.type === 'hello')
        channel.post({ type: 'board', board: useBoardStore.getState().board })
    })
    channelRef.current = channel
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    channelRef.current?.post({ type: 'board', board })
  }, [board])

  useEffect(() => {
    channelRef.current?.post({ type: 'live', live })
  }, [live])

  useEffect(() => {
    channelRef.current?.post({ type: 'reveal', itemId: justPlaced, tierId: cuedTier })
  }, [justPlaced, cuedTier])

  const placeOnDeck = useCallback(
    (tierId: TierId) => {
      if (!onDeck) return
      const tier = board.tiers.find((candidate) => candidate.id === tierId)
      if (!tier) return

      place(onDeck, tierId, tier.itemIds.length)
      setCuedTier(tierId)
      setJustPlaced(onDeck)
    },
    [onDeck, board.tiers, place],
  )

  useHotkeys(
    useMemo(() => {
      const map: Record<string, () => void> = {
        Backspace: undo,
        u: undo,
      }
      board.tiers.slice(0, 9).forEach((tier, index) => {
        map[String(index + 1)] = () => {
          placeOnDeck(tier.id)
        }
      })
      return map
    }, [board.tiers, placeOnDeck, undo]),
  )

  const copyOverlayLink = async (mode: 'live' | 'baked') => {
    const url = mode === 'live' ? overlayUrl() : overlayUrl(await encodeBoard(board))
    const copied = await copyText(url)
    notify(copied ? t('stream.copied') : t('stream.copyFailed'), copied ? 'good' : 'bad')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 py-4 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <Button
            variant={live ? 'danger' : 'primary'}
            icon={live ? 'stop' : 'record'}
            onClick={() => {
              setLive(!live)
            }}
          >
            {live ? t('stream.goOffAir') : t('stream.goLive')}
          </Button>
          <p className="text-xs text-slate">{live ? t('stream.liveHint') : t('stream.offHint')}</p>
        </header>

        {deckItem ? (
          <section className="panel flex flex-1 flex-col items-center justify-center gap-5 p-6">
            <p className="slug">{t('stream.onDeck', { count: board.bench.length })}</p>
            <div className="animate-rise">
              <TileFace item={deckItem} size={deckSize} showLabel={false} />
            </div>
            <h2 className="type-display max-w-[24ch] text-center text-2xl sm:text-3xl">
              {deckItem.label || t('tile.untitled')}
            </h2>

            <div className="flex flex-wrap justify-center gap-2">
              {board.tiers.slice(0, 9).map((tier, index) => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => {
                    placeOnDeck(tier.id)
                  }}
                  className="flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                  style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
                >
                  {tier.label}
                  <span className="type-mono text-[10px] opacity-70">{index + 1}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="panel flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="slug">{t('stream.deckClear')}</p>
            <h2 className="type-display text-xl">{t('stream.deckClearTitle')}</h2>
            <p className="max-w-[42ch] text-sm text-slate">{t('stream.deckClearBody')}</p>
          </section>
        )}

        {upNext.length > 0 ? (
          <section>
            <p className="slug mb-2">{t('stream.upNext')}</p>
            <div className="flex gap-2">
              {upNext.map((item, index) => (
                <div key={item.id} style={{ opacity: 1 - index * 0.16 }}>
                  <TileFace item={item} size={52} showLabel={false} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
        <section className="panel p-3">
          <div className="flex items-center justify-between">
            <p className="slug">{t('stream.program')}</p>
            <IconButton
              icon="undo"
              label={t('stream.undoPlacement')}
              size="sm"
              disabled={!canUndo()}
              onClick={undo}
            />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {board.tiers.map((tier) => (
              <div
                key={tier.id}
                className={cx(
                  'flex items-center gap-2 rounded-tile p-1 transition-shadow',
                  cuedTier === tier.id && 'ring-1 ring-preview',
                )}
                style={{ backgroundColor: tint(tier.color, 0.12) }}
              >
                <span
                  className="type-display grid size-7 shrink-0 place-items-center rounded-[3px] text-sm"
                  style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
                >
                  {tier.label}
                </span>
                <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
                  {tier.itemIds.slice(-8).map((itemId) => {
                    const item = board.items[itemId]
                    return item ? (
                      <div key={itemId} className={cx(justPlaced === itemId && 'animate-land')}>
                        <TileFace item={item} size={26} showLabel={false} />
                      </div>
                    ) : null
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-3">
          <p className="slug">{t('stream.overlay')}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate">{t('stream.overlayBody')}</p>
          <div className="mt-3 flex flex-col gap-2">
            <Button
              icon="copy"
              onClick={() => {
                void copyOverlayLink('baked')
              }}
            >
              {t('stream.copyBaked')}
            </Button>
            <Button
              variant="ghost"
              icon="broadcast"
              onClick={() => {
                void copyOverlayLink('live')
              }}
            >
              {t('stream.copyLive')}
            </Button>
            <Button
              variant="ghost"
              icon="share"
              onClick={() => {
                window.open(overlayUrl(), '_blank', 'noopener,noreferrer,width=1280,height=720')
              }}
            >
              {t('stream.openOverlay')}
            </Button>
          </div>
        </section>
      </aside>
    </div>
  )
}
