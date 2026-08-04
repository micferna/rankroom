import { useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { Button } from '~/components/ui/Button'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import { BENCH, type Item } from '~/types'
import { AddTiles } from './AddTiles'
import { Tile } from './Tile'

interface BenchProps {
  className?: string
  items: Item[]
  tileSize: number
  selection: ReadonlySet<string>
  onSelect: (itemId: string, extend: boolean) => void
  onPickFiles: () => void
  onAddTiles: (labels: string[]) => void
  onShuffle: () => void
}

/** Everything not yet ranked. Named for the sports bench, not a "pool" of assets. */
export function Bench({
  className,
  items,
  tileSize,
  selection,
  onSelect,
  onPickFiles,
  onAddTiles,
  onShuffle,
}: BenchProps) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: BENCH })

  return (
    <section
      aria-label={t('bench.title')}
      // Opaque, because board rows scroll underneath it when it is pinned.
      className={cx('panel flex min-h-0 shrink-0 flex-col bg-desk', className)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-edge px-2 py-1.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className="slug">{t('bench.title')}</h2>
          <span className="type-mono text-[10px] text-slate">{items.length}</span>
        </div>

        <AddTiles onAdd={onAddTiles} className="order-3 w-full sm:order-none sm:ml-auto sm:w-40" />

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <Button
            size="sm"
            variant="ghost"
            icon="shuffle"
            onClick={onShuffle}
            disabled={items.length < 2}
          >
            <span className="hidden sm:inline">{t('bench.shuffle')}</span>
          </Button>
          <Button size="sm" variant="quiet" icon="image" onClick={onPickFiles}>
            <span className="hidden sm:inline">{t('bench.images')}</span>
          </Button>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={cx(
          'flex max-h-40 min-h-16 flex-1 flex-wrap content-start gap-1 overflow-y-auto p-2 transition-colors',
          isOver && 'bg-preview/10',
        )}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
          {items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              size={tileSize}
              selected={selection.has(item.id)}
              onSelect={onSelect}
            />
          ))}
        </SortableContext>

        {items.length === 0 ? (
          <p className="w-full self-center py-4 text-center text-xs text-slate">
            {t('bench.empty')}
          </p>
        ) : null}
      </div>
    </section>
  )
}
