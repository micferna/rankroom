import { useMemo, useState } from 'react'
import { TileFace } from '~/components/board/Tile'
import { Button } from '~/components/ui/Button'
import { Icon } from '~/components/ui/Icon'
import { Field, Segmented, Slider, Switch } from '~/components/ui/Field'
import { useT } from '~/i18n'
import { itemsIn } from '~/lib/board'
import { crowdOrder } from '~/lib/crowd'
import { cx } from '~/lib/cx'
import { readableInk } from '~/lib/palette'
import { isValidChannel } from '~/lib/twitch'
import { useBoardStore } from '~/store/boardStore'
import { selectTally, useCrowdStore } from '~/store/crowdStore'
import { useUiStore } from '~/store/uiStore'
import type { ItemId } from '~/types'

const WINDOWS = [
  { value: '0', minutes: 0 },
  { value: '120000', minutes: 2 },
  { value: '600000', minutes: 10 },
] as const

const STATUS_KEY = {
  idle: 'crowd.status.idle',
  connecting: 'crowd.status.connecting',
  connected: 'crowd.status.connected',
  reconnecting: 'crowd.status.reconnecting',
  error: 'crowd.status.error',
} as const

/**
 * The audience surface: chat votes, and the result shows up as a translucent
 * layer under the streamer's own board. The streamer stays the author — nothing
 * chat says moves a tile on its own; they accept it, item by item or all at once.
 */
export function CrowdMode() {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const place = useBoardStore((state) => state.place)
  const applyRanking = useBoardStore((state) => state.applyRanking)
  const notify = useUiStore((state) => state.notify)

  const channel = useCrowdStore((state) => state.channel)
  const status = useCrowdStore((state) => state.status)
  const config = useCrowdStore((state) => state.config)
  const votes = useCrowdStore((state) => state.votes)
  const feed = useCrowdStore((state) => state.feed)
  const deckItemId = useCrowdStore((state) => state.deckItemId)
  const showGhosts = useCrowdStore((state) => state.showGhosts)
  const connect = useCrowdStore((state) => state.connect)
  const disconnect = useCrowdStore((state) => state.disconnect)
  const setConfig = useCrowdStore((state) => state.setConfig)
  const setDeckItem = useCrowdStore((state) => state.setDeckItem)
  const setShowGhosts = useCrowdStore((state) => state.setShowGhosts)
  const clearVotes = useCrowdStore((state) => state.clearVotes)

  const [draftChannel, setDraftChannel] = useState(channel)

  const tally = useMemo(
    () => selectTally(votes, board, config.windowMs, config.minVotes),
    [votes, board, config.windowMs, config.minVotes],
  )
  const deckItem = deckItemId ? board.items[deckItemId] : undefined
  const deckPlacement = deckItemId ? tally.placements.get(deckItemId) : undefined
  const candidates = useMemo(() => itemsIn(board, board.bench).slice(0, 12), [board])

  const listening = status === 'connected' || status === 'connecting' || status === 'reconnecting'
  const tierLetters = board.tiers.map((tier) => tier.label).join(' · ')
  const example = `${config.prefix}${board.tiers[0]?.label.toLowerCase() ?? 's'} ${
    Object.values(board.items)[0]?.label.split(' ')[0]?.toLowerCase() ?? 'name'
  }`

  const acceptDeck = () => {
    if (!deckItemId || !deckPlacement) {
      notify(t('crowd.noConsensus'), 'bad')
      return
    }
    const tier = board.tiers.find((candidate) => candidate.id === deckPlacement.tierId)
    if (!tier) return

    place(deckItemId, tier.id, tier.itemIds.length)
    notify(
      t('crowd.accepted', {
        label: board.items[deckItemId]?.label ?? '',
        tier: tier.label,
        percent: Math.round(deckPlacement.share * 100),
      }),
      'good',
    )
    setDeckItem(null)
  }

  const acceptAll = () => {
    const order = crowdOrder(tally, board)
    if (order.length === 0) {
      notify(t('crowd.noConsensus'), 'bad')
      return
    }
    applyRanking(order)
    notify(t('crowd.acceptedAll', { count: order.length, voters: tally.voters }), 'good')
  }

  const block = (user: string) => {
    if (config.blocked.includes(user)) return
    setConfig({ blocked: [...config.blocked, user] })
    notify(t('crowd.blocked', { user }), 'good')
  }

  const pickDeck = (itemId: ItemId) => {
    setDeckItem(itemId)
    // A new poll starts clean, otherwise the previous tile's votes bleed in.
    clearVotes()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 py-3 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <section className="panel p-3">
          <p className="slug">{t('crowd.slug')}</p>
          <h1 className="type-display mt-1 text-xl sm:text-2xl">{t('crowd.title')}</h1>
          <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-slate">{t('crowd.body')}</p>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-64">
              <Field
                label={t('crowd.channel')}
                placeholder={t('crowd.channelPlaceholder')}
                value={draftChannel}
                disabled={listening}
                onChange={(event) => {
                  setDraftChannel(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && isValidChannel(draftChannel)) connect(draftChannel)
                }}
              />
            </div>

            {listening ? (
              <Button variant="danger" icon="stop" onClick={disconnect}>
                {t('crowd.disconnect')}
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="broadcast"
                onClick={() => {
                  if (!isValidChannel(draftChannel)) {
                    notify(t('crowd.badChannel'), 'bad')
                    return
                  }
                  connect(draftChannel)
                }}
              >
                {t('crowd.connect')}
              </Button>
            )}
          </div>

          <p
            className={cx(
              'type-mono mt-2 text-[10px]',
              status === 'connected' && 'text-preview',
              status === 'error' && 'text-program',
              status !== 'connected' && status !== 'error' && 'text-slate',
            )}
            role="status"
          >
            {t(STATUS_KEY[status], { channel })}
          </p>
          <p className="mt-1 text-[11px] text-slate">{t('crowd.readOnly')}</p>
        </section>

        {config.mode === 'deck' ? (
          <section className="panel flex flex-col gap-3 p-3">
            <p className="slug">{t('crowd.deck')}</p>

            {deckItem ? (
              <div className="flex flex-wrap items-center gap-4">
                <TileFace item={deckItem} size={88} showLabel={false} />
                <div className="min-w-0 flex-1">
                  <p className="type-display text-lg">{deckItem.label}</p>

                  <ul className="mt-2 flex flex-col gap-1">
                    {board.tiers.map((tier) => {
                      const entry = deckPlacement?.breakdown.find((row) => row.tierId === tier.id)
                      const count = entry?.votes ?? 0
                      const total =
                        deckPlacement?.breakdown.reduce((sum, row) => sum + row.votes, 0) ?? 0
                      const share = total === 0 ? 0 : count / total

                      return (
                        <li key={tier.id} className="flex items-center gap-2">
                          <span
                            className="type-mono grid size-5 shrink-0 place-items-center rounded-[3px] text-[10px] font-bold"
                            style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
                          >
                            {tier.label}
                          </span>
                          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-rail">
                            <span
                              className="block h-full rounded-full transition-[width] duration-300"
                              style={{ width: `${share * 100}%`, backgroundColor: tier.color }}
                            />
                          </span>
                          <span className="type-mono w-8 shrink-0 text-right text-[10px] text-slate">
                            {count}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate">{t('crowd.deckNone')}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="check" disabled={!deckPlacement} onClick={acceptDeck}>
                {t('crowd.acceptDeck')}
              </Button>
            </div>

            {candidates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={t('crowd.pickDeck')}
                    onClick={() => {
                      pickDeck(item.id)
                    }}
                    className={cx(
                      'rounded-tile transition-transform hover:-translate-y-0.5',
                      deckItemId === item.id && 'ring-2 ring-preview',
                    )}
                  >
                    <TileFace item={item} size={40} showLabel={false} />
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="panel p-3">
          <p className="slug mb-2">{t('crowd.instructions')}</p>
          <p className="type-mono rounded-control border border-edge bg-room/60 p-2 text-[11px] leading-relaxed text-chalk">
            {config.mode === 'deck'
              ? t('crowd.instructionsDeck', { letters: tierLetters })
              : t('crowd.instructionsFree', { example })}
          </p>
        </section>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
        <section className="panel p-3">
          <p className="slug mb-2">{t('crowd.mode')}</p>
          <Segmented
            label={t('crowd.mode')}
            value={config.mode}
            options={[
              { value: 'deck', label: t('crowd.mode.deck') },
              { value: 'free', label: t('crowd.mode.free') },
            ]}
            onChange={(mode) => {
              setConfig({ mode })
            }}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-slate">
            {config.mode === 'deck'
              ? t('crowd.mode.deck.hint')
              : t('crowd.mode.free.hint', { example })}
          </p>

          <div className="mt-3">
            <Field
              label={t('crowd.prefix')}
              hint={t('crowd.prefixHint')}
              value={config.prefix}
              maxLength={3}
              onChange={(event) => {
                setConfig({ prefix: event.target.value })
              }}
            />
          </div>

          <div className="mt-3">
            <p className="slug mb-1.5">{t('crowd.window')}</p>
            <Segmented
              label={t('crowd.window')}
              value={String(config.windowMs)}
              options={WINDOWS.map((entry) => ({
                value: entry.value,
                label:
                  entry.minutes === 0
                    ? t('crowd.windowForever')
                    : t('crowd.windowMinutes', { count: entry.minutes }),
              }))}
              onChange={(value) => {
                setConfig({ windowMs: Number(value) })
              }}
            />
          </div>

          <div className="mt-3 border-t border-edge pt-2">
            <p className="slug mb-1.5">{t('crowd.weighting')}</p>
            <Segmented
              label={t('crowd.weighting')}
              value={String(config.subWeight)}
              options={[
                { value: '1', label: t('crowd.weightEqual') },
                { value: '2', label: '×2' },
                { value: '3', label: '×3' },
              ]}
              onChange={(value) => {
                setConfig({ subWeight: Number(value) })
              }}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate">{t('crowd.weightHint')}</p>

            <div className="mt-2">
              <Slider
                label={t('crowd.minVotes')}
                min={1}
                max={20}
                value={config.minVotes}
                onChange={(minVotes) => {
                  setConfig({ minVotes })
                }}
                readout={t('crowd.minVotesReadout', { count: config.minVotes })}
              />
            </div>
          </div>

          <div className="mt-2 border-t border-edge pt-1">
            <Switch
              label={t('crowd.subsOnly')}
              hint={t('crowd.subsOnlyHint')}
              checked={config.subsOnly}
              onChange={(subsOnly) => {
                setConfig({ subsOnly })
              }}
            />
            <Switch
              label={t('crowd.openOnly')}
              checked={config.openOnly}
              onChange={(openOnly) => {
                setConfig({ openOnly })
              }}
            />
            <Switch
              label={t('crowd.showGhosts')}
              hint={t('crowd.showGhostsHint')}
              checked={showGhosts}
              onChange={setShowGhosts}
            />
          </div>
        </section>

        <section className="panel p-3">
          <dl className="type-mono grid grid-cols-3 gap-2 text-[10px] text-slate">
            <div className="rounded-control border border-edge px-2 py-1.5">
              <dt>{t('crowd.voters')}</dt>
              <dd className="text-base text-chalk">{tally.voters}</dd>
            </div>
            <div className="rounded-control border border-edge px-2 py-1.5">
              <dt>{t('crowd.votes')}</dt>
              <dd className="text-base text-chalk">{tally.total}</dd>
            </div>
            <div className="rounded-control border border-edge px-2 py-1.5">
              <dt>{t('crowd.disagreements')}</dt>
              <dd className="text-base text-chalk">{tally.placements.size}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-col gap-2">
            <Button icon="layers" disabled={tally.placements.size === 0} onClick={acceptAll}>
              {t('crowd.acceptAll')}
            </Button>
            <Button
              variant="ghost"
              icon="trash"
              size="sm"
              disabled={votes.size === 0}
              onClick={clearVotes}
            >
              {t('crowd.clearVotes')}
            </Button>
            {config.blocked.length > 0 ? (
              <Button
                variant="ghost"
                icon="undo"
                size="sm"
                onClick={() => {
                  setConfig({ blocked: [] })
                }}
              >
                {t('crowd.unblockAll', { count: config.blocked.length })}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="panel flex min-h-0 flex-1 flex-col p-3">
          <p className="slug mb-2">{t('crowd.feed')}</p>
          {feed.length === 0 ? (
            <p className="text-[11px] text-slate">{t('crowd.feedEmpty')}</p>
          ) : (
            <ul className="flex max-h-64 min-h-0 flex-col gap-1 overflow-y-auto">
              {feed.map((entry) => (
                <li
                  key={entry.id}
                  className={cx(
                    'group/line flex items-baseline gap-1 rounded-control px-1.5 py-0.5 text-[11px]',
                    entry.counted ? 'bg-preview/10 text-chalk' : 'text-slate',
                  )}
                >
                  <span className="shrink-0 font-semibold">{entry.display}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                  <button
                    type="button"
                    title={t('crowd.block', { user: entry.display })}
                    onClick={() => {
                      block(entry.display.toLowerCase())
                    }}
                    className="shrink-0 text-program opacity-0 transition-opacity group-hover/line:opacity-100 focus-visible:opacity-100"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}
