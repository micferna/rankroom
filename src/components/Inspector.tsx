import { useState } from 'react'
import { TileFace } from '~/components/board/Tile'
import { Button, IconButton } from '~/components/ui/Button'
import { Field, Slider } from '~/components/ui/Field'
import { useTileSize } from '~/hooks/useViewport'
import { useT } from '~/i18n'
import { itemCount, rankedCount } from '~/lib/board'
import { cx } from '~/lib/cx'
import { paletteById, readableInk } from '~/lib/palette'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import { BENCH } from '~/types'

interface InspectorProps {
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
}

/**
 * The right-hand rail on a desktop; a collapsed drawer on a phone, where the
 * board itself has to own the screen.
 */
export function Inspector({ selection, onSelectionChange }: InspectorProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const setSubtitle = useBoardStore((state) => state.setSubtitle)
  const renameItem = useBoardStore((state) => state.renameItem)
  const removeItem = useBoardStore((state) => state.removeItem)
  const paletteId = useBoardStore((state) => state.paletteId)
  const clearPlacements = useBoardStore((state) => state.clearPlacements)

  const tilePreference = useUiStore((state) => state.tileSize)
  const setTileSize = useUiStore((state) => state.setTileSize)
  const tileSize = useTileSize(tilePreference)
  const openDialog = useUiStore((state) => state.openDialog)

  const [open, setOpen] = useState(false)

  const place = useBoardStore((state) => state.place)

  const clearSelection = () => {
    onSelectionChange(new Set())
  }

  const ids = [...selection].filter((id) => id in board.items)
  const selected = ids.length === 1 ? board.items[ids[0] ?? ''] : undefined

  const moveSelection = (tierId: string) => {
    const tier = board.tiers.find((candidate) => candidate.id === tierId)
    if (!tier) return
    // Placed one after another so the group keeps its relative order.
    ids.forEach((id, offset) => {
      place(id, tierId, tier.itemIds.length + offset)
    })
    clearSelection()
  }

  const removeSelection = () => {
    for (const id of ids) removeItem(id)
    clearSelection()
  }
  const total = itemCount(board)
  const ranked = rankedCount(board)

  return (
    <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-64">
      {/* The selected tile is the one panel worth showing unprompted on mobile. */}
      {ids.length > 1 ? (
        <section className="panel animate-rise p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="slug">{t('inspector.selectedMany', { count: ids.length })}</p>
            <IconButton
              icon="close"
              label={t('inspector.clearSelection')}
              size="sm"
              onClick={clearSelection}
            />
          </div>

          <p className="slug mt-2 mb-1">{t('inspector.moveTo')}</p>
          <div className="flex flex-wrap gap-1">
            {board.tiers.map((tier) => (
              <button
                key={tier.id}
                type="button"
                onClick={() => {
                  moveSelection(tier.id)
                }}
                className="type-display grid size-7 place-items-center rounded-[3px] text-xs transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: tier.color, color: readableInk(tier.color) }}
              >
                {tier.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                ids.forEach((id, offset) => {
                  place(id, BENCH, offset)
                })
                clearSelection()
              }}
              className="rounded-[3px] border border-edge px-2 text-[10px] text-slate transition-colors hover:text-chalk"
            >
              {t('bench.title')}
            </button>
          </div>

          <Button
            variant="danger"
            icon="trash"
            size="sm"
            className="mt-2 w-full"
            onClick={removeSelection}
          >
            {t('inspector.removeMany', { count: ids.length })}
          </Button>
        </section>
      ) : null}

      {selected ? (
        <section className="panel animate-rise p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="slug">{t('inspector.selected')}</p>
            <IconButton
              icon="close"
              label={t('inspector.clearSelection')}
              size="sm"
              onClick={clearSelection}
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <TileFace item={selected} size={44} showLabel={false} />
            <div className="min-w-0 flex-1">
              <Field
                label={t('inspector.name')}
                quietLabel
                value={selected.label}
                maxLength={80}
                onChange={(event) => {
                  renameItem(selected.id, event.target.value)
                }}
              />
            </div>
            <IconButton
              icon="trash"
              label={t('inspector.remove')}
              variant="danger"
              size="sm"
              onClick={() => {
                removeItem(selected.id)
                clearSelection()
              }}
            />
          </div>
        </section>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
        className="panel flex items-center justify-between px-2.5 py-2 text-xs text-slate transition-colors hover:text-chalk lg:hidden"
      >
        {open ? t('inspector.hide') : t('inspector.show')}
        <span className="type-mono text-[10px]">
          {ranked}/{total}
        </span>
      </button>

      <div className={cx('flex-col gap-2', open ? 'flex' : 'hidden lg:flex')}>
        <section className="panel p-2.5">
          <p className="slug">{t('inspector.board')}</p>

          <div className="mt-2">
            <Field
              label={t('inspector.subtitle')}
              quietLabel
              placeholder={t('inspector.subtitlePlaceholder')}
              value={board.subtitle}
              maxLength={160}
              onChange={(event) => {
                setSubtitle(event.target.value)
              }}
            />
          </div>

          <dl className="type-mono mt-2 grid grid-cols-2 gap-1.5 text-[10px] text-slate">
            <div className="rounded-control border border-edge px-2 py-1">
              <dt>{t('inspector.tiles')}</dt>
              <dd className="text-chalk">{total}</dd>
            </div>
            <div className="rounded-control border border-edge px-2 py-1">
              <dt>{t('inspector.ranked')}</dt>
              <dd className="text-chalk">
                {ranked}/{total}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel p-2.5">
          <Slider
            label={t('inspector.tileSize')}
            min={36}
            max={112}
            step={4}
            value={tileSize}
            onChange={setTileSize}
            readout={tilePreference === 'auto' ? t('inspector.tileAuto') : `${tileSize}px`}
          />

          {tilePreference !== 'auto' ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              onClick={() => {
                setTileSize('auto')
              }}
            >
              {t('inspector.tileAutoReset')}
            </Button>
          ) : null}

          <Button
            icon="layers"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              openDialog('palette')
            }}
          >
            {t('inspector.colours', { palette: paletteById(paletteId).name })}
          </Button>

          <Button
            variant="ghost"
            icon="rewind"
            size="sm"
            className="mt-1 w-full"
            disabled={ranked === 0}
            onClick={clearPlacements}
          >
            {t('inspector.reset')}
          </Button>
        </section>
      </div>
    </aside>
  )
}
