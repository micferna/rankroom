import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo } from 'react'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import type { Item } from '~/types'

interface TileFaceProps {
  item: Item
  /** Tile size in pixels; the bench and the rows use different scales. */
  size: number
  selected?: boolean
  showLabel?: boolean
}

/** The visual only — no drag wiring — so the overlay and previews can reuse it. */
export const TileFace = memo(function TileFace({
  item,
  size,
  selected = false,
  showLabel = true,
}: TileFaceProps) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-tile bg-rail',
        'ring-1 ring-inset ring-chalk/10',
        selected && 'ring-2 ring-preview',
      )}
      style={{ width: size, height: size }}
    >
      {item.image ? (
        <img
          src={item.image}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="no-drag size-full object-cover"
        />
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{ backgroundColor: `hsl(${item.hue} 46% var(--tile-lightness))` }}
        >
          <span
            className="type-display text-chalk/90"
            style={{ fontSize: Math.round(size * 0.32) }}
            aria-hidden
          >
            {item.label.slice(0, 2) || '?'}
          </span>
        </div>
      )}

      {/* Below ~44px there is no room for a name anyone could read. */}
      {showLabel && item.label && size >= 44 ? (
        <span
          className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1 pt-3 pb-0.5 text-center font-semibold text-white"
          style={{ fontSize: Math.max(8, Math.round(size * 0.15)) }}
        >
          {item.label}
        </span>
      ) : null}
    </div>
  )
})

interface GhostTileProps {
  item: Item
  size: number
  votes: number
  share: number
}

/**
 * Where chat put an item, drawn alongside the streamer's own placements.
 *
 * Translucent and dashed on purpose: on camera the audience layer has to read as
 * *a suggestion*, instantly distinguishable from what the streamer decided,
 * without a legend explaining which is which.
 */
export const GhostTile = memo(function GhostTile({ item, size, votes, share }: GhostTileProps) {
  const t = useT()

  return (
    <div
      role="img"
      aria-label={t('crowd.ghostAria', { label: item.label, votes })}
      title={t('crowd.ghost', { label: item.label })}
      className="relative opacity-50 transition-opacity hover:opacity-90"
    >
      <div className="rounded-tile border border-dashed border-chalk/60 p-px">
        <TileFace item={item} size={size - 4} showLabel={false} />
      </div>
      <span
        aria-hidden
        className="type-mono absolute -right-1 -bottom-1 rounded-full bg-room px-1 text-[9px] leading-4 font-bold text-chalk ring-1 ring-chalk/25"
      >
        {votes}
      </span>
      <span
        aria-hidden
        className="absolute inset-x-px bottom-px h-0.5 rounded-full bg-preview"
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  )
})

interface TileProps extends TileFaceProps {
  onSelect?: (itemId: string) => void
}

export function Tile({ item, size, selected = false, onSelect, showLabel = true }: TileProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      // The accessible name has to carry the label: the image itself is decorative.
      aria-label={item.label || t('tile.untitled')}
      onClick={() => onSelect?.(item.id)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: 'none',
      }}
      className={cx(
        'cursor-grab rounded-tile focus-visible:z-10 active:cursor-grabbing',
        // The original stays as a translucent placeholder while the overlay follows the pointer.
        isDragging && 'opacity-25',
      )}
      {...attributes}
      {...listeners}
    >
      <TileFace item={item} size={size} selected={selected} showLabel={showLabel} />
    </button>
  )
}
