import { useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { useState } from 'react'
import { useT } from '~/i18n'
import type { CrowdPlacement } from '~/lib/crowd'
import { cx } from '~/lib/cx'
import { readableInk, tint } from '~/lib/palette'
import type { Item, Tier } from '~/types'
import { TierMenu } from './TierMenu'
import { GhostTile, Tile } from './Tile'

interface TierRowProps {
  tier: Tier
  items: Item[]
  tileSize: number
  selection: ReadonlySet<string>
  /** Where chat would put items in this tier, drawn as a translucent layer. */
  ghosts?: { placement: CrowdPlacement; item: Item }[]
  onSelect: (itemId: string, extend: boolean) => void
  onRename: (label: string) => void
  onRecolor: (color: string) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  canMoveUp: boolean
  canMoveDown: boolean
  canRemove: boolean
}

export function TierRow({
  tier,
  items,
  tileSize,
  selection,
  ghosts,
  onSelect,
  onRename,
  onRecolor,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  canRemove,
}: TierRowProps) {
  const t = useT()
  const { setNodeRef, isOver } = useDroppable({ id: tier.id })
  const [editing, setEditing] = useState(false)

  // The slug tracks the tile scale so a small board stays proportional.
  const slugWidth = Math.round(Math.max(40, Math.min(72, tileSize * 1.05)))

  return (
    <section
      className="group/row flex items-stretch gap-1"
      aria-label={t('tier.aria', { label: tier.label })}
    >
      {/* The channel strip: a physical-feeling slug carrying the tier's identity. */}
      <div
        className="relative flex shrink-0 flex-col items-center justify-center rounded-tile px-1 py-1"
        style={{ width: slugWidth, backgroundColor: tier.color, color: readableInk(tier.color) }}
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={tier.label}
            aria-label={t('tier.name')}
            maxLength={12}
            onBlur={(event) => {
              onRename(event.target.value.trim() || tier.label)
              setEditing(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setEditing(false)
            }}
            className="type-display w-full bg-transparent text-center text-lg outline-none"
            style={{ color: readableInk(tier.color) }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(true)
            }}
            title={t('tier.rename')}
            className="type-display w-full truncate text-center leading-none"
            style={{ fontSize: Math.round(slugWidth * 0.42) }}
          >
            {tier.label}
          </button>
        )}

        <span className="type-mono mt-0.5 text-[9px] opacity-70">{items.length}</span>

        {/* The menu sits inside the slug so the row's height is set by the tiles
            alone — a separate control column cost ~28px on every row. */}
        <div className="absolute top-0.5 right-0.5">
          <TierMenu
            label={tier.label}
            ink={readableInk(tier.color)}
            color={tier.color}
            onRecolor={onRecolor}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            canRemove={canRemove}
            onMove={onMove}
            onRemove={onRemove}
          />
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cx(
          'flex flex-1 flex-wrap content-start gap-1 rounded-tile p-1 transition-colors',
          isOver && 'outline outline-1 outline-preview/50',
        )}
        style={{
          minHeight: tileSize + 8,
          backgroundColor: isOver ? 'rgb(34 221 138 / 0.1)' : tint(tier.color, 0.06),
        }}
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

        {ghosts?.map(({ placement, item }) => (
          <GhostTile
            key={`ghost-${item.id}`}
            item={item}
            size={tileSize}
            votes={placement.votes}
            share={placement.share}
          />
        ))}

        {items.length === 0 && !ghosts?.length ? (
          <p className="slug self-center px-2 py-2 opacity-60">{t('tier.dropHere')}</p>
        ) : null}
      </div>
    </section>
  )
}
