import { useMemo, useState } from 'react'
import { TileFace } from '~/components/board/Tile'
import { bucketSizes } from '~/lib/board'
import { Button, IconButton } from '~/components/ui/Button'
import { useT } from '~/i18n'
import type { MessageKey } from '~/i18n/en'
import { useHotkeys } from '~/hooks/useHotkeys'
import { stageTileSize, useViewport } from '~/hooks/useViewport'
import {
  answerDuel,
  canUndoDuel,
  duelPair,
  duelProgress,
  estimatedComparisons,
  isDuelComplete,
  parkCurrent,
  remainingComparisons,
  startDuel,
  undoDuel,
  type DuelState,
  type DuelVerdict,
} from '~/lib/duel'
import { cx } from '~/lib/cx'
import { readableInk } from '~/lib/palette'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { ItemId } from '~/types'

/**
 * Weight shapes for turning a ranking into tiers. Weights are relative sizes
 * from the best tier down, normalised against the board's actual tier count.
 */
const SHAPES = [
  { id: 'even', label: 'duel.shape.even', hint: 'duel.shape.even.hint' },
  { id: 'peak', label: 'duel.shape.peak', hint: 'duel.shape.peak.hint' },
  { id: 'bell', label: 'duel.shape.bell', hint: 'duel.shape.bell.hint' },
] as const satisfies readonly { id: string; label: MessageKey; hint: MessageKey }[]

type ShapeId = (typeof SHAPES)[number]['id']

function weightsFor(shape: ShapeId, tierCount: number): number[] {
  if (shape === 'even') return new Array<number>(tierCount).fill(1)
  if (shape === 'peak') return Array.from({ length: tierCount }, (_, index) => 1 + index * 0.7)

  const middle = (tierCount - 1) / 2
  return Array.from(
    { length: tierCount },
    (_, index) => 1 + (middle - Math.abs(index - middle)) * 1.4,
  )
}

export function DuelMode() {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const applyRanking = useBoardStore((state) => state.applyRanking)
  const setMode = useUiStore((state) => state.setMode)
  const notify = useUiStore((state) => state.notify)

  const [duel, setDuel] = useState<DuelState | null>(null)
  const [shape, setShape] = useState<ShapeId>('peak')
  const tileSize = stageTileSize(useViewport(), 0.3, 210)

  const benchIds = board.bench
  const allIds = useMemo(() => Object.keys(board.items), [board.items])

  const pair = duel ? duelPair(duel) : null
  const complete = duel !== null && isDuelComplete(duel)

  const answer = (verdict: DuelVerdict) => {
    setDuel((current) => (current ? answerDuel(current, verdict) : current))
  }

  useHotkeys(
    {
      ArrowLeft: () => {
        answer('left')
      },
      ArrowRight: () => {
        answer('right')
      },
      ' ': () => {
        answer('tie')
      },
      s: () => {
        setDuel((current) => (current ? parkCurrent(current) : current))
      },
      u: () => {
        setDuel((current) => (current ? undoDuel(current) : current))
      },
    },
    pair !== null,
  )

  if (!duel) {
    return (
      <Setup
        benchCount={benchIds.length}
        totalCount={allIds.length}
        onStart={(ids) => {
          if (ids.length < 2) {
            notify(t('duel.tooFew'), 'bad')
            return
          }
          setDuel(startDuel(ids))
        }}
      />
    )
  }

  if (complete) {
    return (
      <Results
        duel={duel}
        shape={shape}
        onShape={setShape}
        onApply={() => {
          applyRanking(duel.ranked, weightsFor(shape, board.tiers.length))
          notify(t('duel.applied', { count: duel.ranked.length, duels: duel.comparisons }), 'good')
          setMode('edit')
        }}
        onRestart={() => {
          setDuel(null)
        }}
        labelOf={(id) => board.items[id]?.label ?? ''}
      />
    )
  }

  if (!pair) return null

  const left = board.items[pair.left]
  const right = board.items[pair.right]
  if (!left || !right) return null

  const progress = duelProgress(duel)

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col justify-center gap-4 py-4 sm:gap-6">
      <header className="text-center">
        <p className="slug">
          {t('duel.counter', {
            number: duel.comparisons + 1,
            remaining: remainingComparisons(duel),
          })}
        </p>
        <h1 className="type-display mt-1.5 text-xl sm:text-3xl">{t('duel.question')}</h1>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        {[
          { item: left, verdict: 'left' as const, key: '←' },
          { item: right, verdict: 'right' as const, key: '→' },
        ].map(({ item, verdict, key }) => (
          <button
            key={verdict}
            type="button"
            onClick={() => {
              answer(verdict)
            }}
            className={cx(
              'group flex flex-col items-center gap-3 rounded-panel border border-edge bg-desk p-3 sm:gap-4 sm:p-5',
              'transition-[border-color,transform] hover:-translate-y-0.5 hover:border-preview/60',
            )}
          >
            <TileFace item={item} size={tileSize} showLabel={false} />
            <span className="line-clamp-2 text-center text-sm font-semibold sm:text-base">
              {item.label || 'Untitled'}
            </span>
            <span className="kbd">{key}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => {
            answer('tie')
          }}
        >
          {t('duel.tie')}
          <span className="kbd ml-1">{t('duel.space')}</span>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDuel(parkCurrent(duel))
          }}
        >
          {t('duel.skip')}
          <span className="kbd ml-1">S</span>
        </Button>
        <Button
          variant="ghost"
          icon="undo"
          disabled={!canUndoDuel(duel)}
          onClick={() => {
            setDuel(undoDuel(duel))
          }}
        >
          {t('action.undo')}
          <span className="kbd ml-1">U</span>
        </Button>
      </div>

      <div>
        <div className="h-1 overflow-hidden rounded-full bg-rail">
          <div
            className="h-full rounded-full bg-preview transition-[width] duration-300"
            style={{ width: `${(progress * 100).toFixed(1)}%` }}
          />
        </div>
        <p className="type-mono mt-2 text-center text-[10px] text-slate uppercase">
          {t('duel.placed', { placed: duel.ranked.length, waiting: duel.queue.length })}
        </p>
      </div>
    </div>
  )
}

interface SetupProps {
  benchCount: number
  totalCount: number
  onStart: (ids: ItemId[]) => void
}

function Setup({ benchCount, totalCount, onStart }: SetupProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-10">
      <p className="slug">{t('duel.setupSlug')}</p>
      <h1 className="type-display mt-1.5 text-2xl sm:text-3xl">{t('duel.setupTitle')}</h1>
      <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-slate">
        {t('duel.setupBody', {
          total: totalCount,
          duels: estimatedComparisons(totalCount),
          roundRobin: Math.round((totalCount * (totalCount - 1)) / 2),
        })}
      </p>

      <div className="mt-7 flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon="duel"
          disabled={benchCount < 2}
          onClick={() => {
            onStart([...board.bench])
          }}
        >
          {t('duel.startBench', { count: benchCount })}
        </Button>
        <Button
          icon="layers"
          disabled={totalCount < 2}
          onClick={() => {
            onStart(Object.keys(board.items))
          }}
        >
          {t('duel.startAll', { count: totalCount })}
        </Button>
      </div>

      {totalCount < 2 ? <p className="mt-4 text-xs text-program">{t('duel.needTwo')}</p> : null}
    </div>
  )
}

interface ResultsProps {
  duel: DuelState
  shape: ShapeId
  onShape: (shape: ShapeId) => void
  onApply: () => void
  onRestart: () => void
  labelOf: (id: ItemId) => string
}

function Results({ duel, shape, onShape, onApply, onRestart, labelOf }: ResultsProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)

  // Same maths the board placement uses, so the preview is the result.
  const tierOfRank = useMemo(() => {
    const sizes = bucketSizes(duel.ranked.length, weightsFor(shape, board.tiers.length))
    return sizes.flatMap((size, tierIndex) => new Array<number>(size).fill(tierIndex))
  }, [duel.ranked.length, shape, board.tiers.length])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 py-8">
      <header>
        <p className="slug">{t('duel.completeSlug')}</p>
        <h1 className="type-display mt-1.5 text-2xl">
          {t('duel.completeTitle', { count: duel.ranked.length, duels: duel.comparisons })}
        </h1>
        {duel.parked.length > 0 ? (
          <p className="mt-2 text-xs text-slate">
            {t('duel.skipped', { count: duel.parked.length })}
          </p>
        ) : null}
      </header>

      <div>
        <p className="slug mb-2">{t('duel.shape')}</p>
        <div className="flex flex-wrap gap-2">
          {SHAPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                onShape(entry.id)
              }}
              aria-pressed={shape === entry.id}
              className={cx(
                'rounded-control border px-3 py-2 text-left text-xs transition-colors',
                shape === entry.id
                  ? 'border-preview/60 bg-preview/10 text-chalk'
                  : 'border-edge text-slate hover:text-chalk',
              )}
            >
              <span className="block font-semibold">{t(entry.label)}</span>
              <span className="block text-[11px] opacity-80">{t(entry.hint)}</span>
            </button>
          ))}
        </div>
      </div>

      <ol className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto rounded-panel border border-edge">
        {duel.ranked.map((itemId, index) => {
          const tier = board.tiers[tierOfRank[index] ?? board.tiers.length - 1]
          if (!tier) return null

          return (
            <li key={itemId} className="flex items-center gap-3 px-3 py-2">
              <span className="type-mono w-8 shrink-0 text-[11px] text-slate">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span
                className="type-mono grid size-6 shrink-0 place-items-center rounded-[3px] text-[10px] font-bold"
                style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
              >
                {tier.label}
              </span>
              <span className="truncate text-sm">{labelOf(itemId)}</span>
            </li>
          )
        })}
      </ol>

      <footer className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="check" onClick={onApply}>
          {t('duel.apply')}
        </Button>
        <IconButton icon="rewind" label={t('duel.restart')} onClick={onRestart} />
        <p className="text-xs text-slate">{t('duel.applyWarning')}</p>
      </footer>
    </div>
  )
}
