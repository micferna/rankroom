import { useMemo, useRef, useState } from 'react'
import { TileFace } from '~/components/board/Tile'
import { Button } from '~/components/ui/Button'
import { Field } from '~/components/ui/Field'
import { useT, type Translate } from '~/i18n'
import { errorKey } from '~/lib/errors'
import { compareBoards } from '~/lib/compare'
import { cx } from '~/lib/cx'
import { readableInk } from '~/lib/palette'
import { BoardParseError, parseBoard } from '~/lib/schema'
import { decodeBoard, readShareToken } from '~/lib/share'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { Board, CompareRow } from '~/types'

/**
 * Compare answers the question a reaction video is built around: where exactly
 * do we disagree? Agreement is a distance score, not an exact-match count, so
 * "one tier apart" reads very differently from "opposite ends of the board".
 */
export function CompareMode() {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const notify = useUiStore((state) => state.notify)

  const [other, setOther] = useState<Board | null>(null)
  const [link, setLink] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const result = useMemo(() => (other ? compareBoards(board, other) : null), [board, other])

  const loadFromLink = async () => {
    const trimmed = link.trim()
    if (!trimmed) return

    try {
      const hash = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#')) : `#/b/${trimmed}`
      const token = readShareToken(hash)
      if (!token) throw new BoardParseError('compare.notALink')

      setOther(await decodeBoard(token))
      notify(t('compare.loaded'), 'good')
    } catch (error) {
      notify(t(errorKey(error, 'compare.badLink')), 'bad')
    }
  }

  const loadFromFile = async (file: File) => {
    try {
      setOther(parseBoard(JSON.parse(await file.text())))
      notify(t('compare.loaded'), 'good')
    } catch (error) {
      notify(t(errorKey(error, 'compare.badFile')), 'bad')
    }
  }

  if (!result || !other) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 py-10">
        <div>
          <p className="slug">{t('compare.slug')}</p>
          <h1 className="type-display mt-1.5 text-2xl">{t('compare.title')}</h1>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-slate">
            {t('compare.body')}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Field
            label={t('compare.link')}
            placeholder={t('compare.linkPlaceholder')}
            value={link}
            onChange={(event) => {
              setLink(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadFromLink()
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="target"
              disabled={!link.trim()}
              onClick={() => {
                void loadFromLink()
              }}
            >
              {t('compare.go')}
            </Button>
            <Button
              icon="upload"
              onClick={() => {
                fileRef.current?.click()
              }}
            >
              {t('compare.loadFile')}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void loadFromFile(file)
              event.target.value = ''
            }}
          />
        </div>
      </div>
    )
  }

  const agreementPct = Math.round(result.agreement * 100)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 py-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="slug">{t('compare.slug')}</p>
          <h1 className="type-display mt-1 text-xl sm:text-2xl">
            {board.title} <span className="text-slate">{t('compare.versus')}</span> {other.title}
          </h1>
        </div>
        <Button
          variant="ghost"
          icon="close"
          onClick={() => {
            setOther(null)
            setLink('')
          }}
        >
          {t('compare.reset')}
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Agreement"
          value={`${agreementPct}%`}
          tone={agreementPct >= 70 ? 'good' : 'bad'}
        />
        <Stat label="Same tier" value={`${result.exactMatches}/${result.measured}`} />
        <Stat label="Only yours" value={String(result.onlyLeft)} />
        <Stat label="Only theirs" value={String(result.onlyRight)} />
      </div>

      {result.hotTakes.length > 0 ? (
        <section>
          <p className="slug mb-2">{t('compare.hotTakes')}</p>
          <div className="flex flex-wrap gap-2">
            {result.hotTakes.map((row) => (
              <div key={row.itemId} className="panel flex items-center gap-3 p-2">
                {row.image ? (
                  <TileFace
                    item={{ id: row.itemId, label: row.label, image: row.image, hue: 0 }}
                    size={40}
                    showLabel={false}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{row.label}</p>
                  <p className="type-mono text-[10px] text-program">
                    {row.gap === null ? '' : t('compare.tiersApart', { gap: row.gap.toFixed(1) })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('compare.tableCaption')}</caption>
          <thead className="sticky top-0 bg-room">
            <tr className="slug text-left">
              <th scope="col" className="py-2">
                {t('compare.item')}
              </th>
              <th scope="col" className="py-2">
                {t('compare.yours')}
              </th>
              <th scope="col" className="py-2">
                {t('compare.theirs')}
              </th>
              <th scope="col" className="py-2 text-right">
                {t('compare.gap')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {result.rows.map((row) => (
              <tr key={row.itemId}>
                <td className="max-w-0 truncate py-1.5 pr-3">{row.label || t('tile.untitled')}</td>
                <td className="py-1.5">
                  <TierChip index={row.left} board={board} />
                </td>
                <td className="py-1.5">
                  <TierChip index={row.right} board={other} />
                </td>
                <td className="type-mono py-1.5 text-right text-[11px]">
                  <Gap row={row} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="panel p-3">
      <p className="slug">{label}</p>
      <p
        className={cx(
          'type-display mt-1 text-2xl',
          tone === 'good' && 'text-preview',
          tone === 'bad' && 'text-tungsten',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function TierChip({ index, board }: { index: number | null; board: Board }) {
  if (index === null) return <span className="text-xs text-slate">—</span>

  const tier = board.tiers[index]
  if (!tier) return <span className="text-xs text-slate">—</span>

  return (
    <span
      className="type-mono inline-grid size-5 place-items-center rounded-[3px] text-[10px] font-bold"
      style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
    >
      {tier.label}
    </span>
  )
}

function Gap({ row, t }: { row: CompareRow; t: Translate }) {
  if (row.gap === null) return <span className="text-slate">—</span>
  if (row.gap === 0) return <span className="text-preview">{t('compare.match')}</span>
  return (
    <span className={row.gap >= 2 ? 'text-program' : 'text-tungsten'}>{row.gap.toFixed(1)}</span>
  )
}
