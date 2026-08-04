import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { useTileSize } from '~/hooks/useViewport'
import { useT } from '~/i18n'
import { itemsIn, moveItem } from '~/lib/board'
import { finalDrop, overZone, previewDrop } from '~/lib/dnd'
import { crowdGhosts, type CrowdPlacement } from '~/lib/crowd'
import { selectTally, useCrowdStore } from '~/store/crowdStore'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import { BENCH, type Board, type Item, type ItemId, type TierId, type ZoneId } from '~/types'
import { Bench } from './Bench'
import { TestCard } from './TestCard'
import { TierRow } from './TierRow'
import { TileFace } from './Tile'

interface BoardCanvasProps {
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
  onPickFiles: () => void
  onAddTiles: (labels: string[]) => void
  onBrowseTemplates: () => void
  onPickFolder: () => void
}

/**
 * Pointer-first collision detection.
 *
 * `closestCorners` alone compares the drag against *every* droppable, tiles
 * included, so a far-away tile in another row could win over the row the cursor
 * was actually inside — "I drop it here and it lands somewhere else". Asking
 * what is under the pointer first, and only falling back to geometry when the
 * pointer is outside everything, matches what the user sees.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions

  const intersections = rectIntersection(args)
  return intersections.length > 0 ? intersections : closestCenter(args)
}

export function BoardCanvas({
  selection,
  onSelectionChange,
  onPickFiles,
  onAddTiles,
  onBrowseTemplates,
  onPickFolder,
}: BoardCanvasProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const place = useBoardStore((state) => state.place)
  const addTier = useBoardStore((state) => state.addTier)
  const removeTier = useBoardStore((state) => state.removeTier)
  const updateTier = useBoardStore((state) => state.updateTier)
  const reorderTier = useBoardStore((state) => state.reorderTier)
  const sortTier = useBoardStore((state) => state.sortTier)
  const shuffle = useBoardStore((state) => state.shuffle)
  const tileSize = useTileSize(useUiStore((state) => state.tileSize))

  const votes = useCrowdStore((state) => state.votes)
  const windowMs = useCrowdStore((state) => state.config.windowMs)
  const showGhosts = useCrowdStore((state) => state.showGhosts)

  /**
   * While a drag is in flight the board is previewed locally, so gaps open up
   * live without writing to the store. Exactly one commit — and therefore one
   * undo step and one replay entry — happens on drop.
   */
  const [draft, setDraft] = useState<Board | null>(null)
  const [activeId, setActiveId] = useState<ItemId | null>(null)
  const view = draft ?? board

  const select = useCallback(
    (itemId: string, extend: boolean) => {
      if (!extend) {
        // Clicking the only selected tile clears, so there is always a way out.
        onSelectionChange(
          selection.size === 1 && selection.has(itemId) ? new Set() : new Set([itemId]),
        )
        return
      }

      const next = new Set(selection)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      onSelectionChange(next)
    },
    [selection, onSelectionChange],
  )

  /** Tiles that travel with a drag: the selection when the dragged tile is in it. */
  const draggedGroup = useCallback(
    (itemId: ItemId): ItemId[] => (selection.has(itemId) ? [...selection] : [itemId]),
    [selection],
  )

  const ghostsByTier = useMemo(() => {
    if (!showGhosts || votes.size === 0) return null
    const byTier = crowdGhosts(selectTally(votes, board, windowMs), board)

    const resolved = new Map<TierId, { placement: CrowdPlacement; item: Item }[]>()
    for (const [tierId, placements] of byTier) {
      resolved.set(
        tierId,
        placements
          .map((placement) => ({ placement, item: board.items[placement.itemId] }))
          .filter((entry): entry is { placement: CrowdPlacement; item: Item } =>
            Boolean(entry.item),
          ),
      )
    }
    return resolved
  }, [showGhosts, votes, board, windowMs])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // A short hold before dragging leaves room for scrolling a long bench by touch.
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const zoneName = useCallback(
    (zone: ZoneId | null) =>
      zone === BENCH
        ? t('tile.zoneBench')
        : t('tile.zoneTier', {
            label: view.tiers.find((tier) => tier.id === zone)?.label ?? '',
          }),
    [view.tiers, t],
  )

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        t('tile.pickedUp', { label: view.items[active.id]?.label ?? t('tile.untitled') }),
      onDragOver: ({ active, over }) =>
        over
          ? t('tile.over', {
              label: view.items[active.id]?.label ?? t('tile.untitled'),
              zone: zoneName(overZone(view, String(over.id))),
            })
          : '',
      onDragEnd: ({ active, over }) =>
        over
          ? t('tile.dropped', {
              label: view.items[active.id]?.label ?? t('tile.untitled'),
              zone: zoneName(overZone(view, String(over.id))),
            })
          : t('tile.dropCancelled'),
      onDragCancel: () => t('tile.dropCancelled'),
    }),
    [view, zoneName, t],
  )

  const handleDragStart = (event: DragStartEvent) => {
    const itemId = String(event.active.id)
    setActiveId(itemId)
    setDraft(board)
    // Dragging an unselected tile makes it the selection; dragging a selected
    // one keeps the group so the whole thing moves together.
    if (!selection.has(itemId)) onSelectionChange(new Set([itemId]))
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !draft) return

    const target = previewDrop(draft, String(active.id), String(over.id))
    if (!target) return

    const next = moveItem(draft, String(active.id), target.zone, target.index)
    if (next !== draft) setDraft(next)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const itemId = String(event.active.id)
    const settled = draft

    setDraft(null)
    setActiveId(null)
    if (!settled) return

    const target = finalDrop(settled, itemId, event.over ? String(event.over.id) : null)
    if (!target) return

    const { zone, index } = target
    place(itemId, zone, index)

    // The rest of the selection follows, landing just after the dragged tile in
    // the order it already had.
    const followers = draggedGroup(itemId).filter((id) => id !== itemId)
    followers.forEach((id, offset) => {
      place(id, zone, index + 1 + offset)
    })
  }

  const activeItem = activeId ? view.items[activeId] : undefined
  const hasItems = Object.keys(view.items).length > 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // Rows change size as tiles move between them, so cached rects go stale
      // mid-drag and every later drop resolves against the old layout.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{ announcements }}
      modifiers={[restrictToWindowEdges]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDraft(null)
        setActiveId(null)
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {/* Only the tiers scroll. The bench stays put, because a drop target that
            can scroll out of view is the worst kind. */}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {!hasItems ? (
            <TestCard
              onPickFiles={onPickFiles}
              onAddTiles={onAddTiles}
              onBrowseTemplates={onBrowseTemplates}
              onPickFolder={onPickFolder}
            />
          ) : (
            view.tiers.map((tier, index) => (
              <TierRow
                key={tier.id}
                tier={tier}
                tileSize={tileSize}
                items={itemsIn(view, tier.itemIds)}
                ghosts={ghostsByTier?.get(tier.id)}
                selection={selection}
                onSelect={select}
                onRename={(label) => {
                  updateTier(tier.id, { label })
                }}
                onRecolor={(color) => {
                  updateTier(tier.id, { color })
                }}
                onRemove={() => {
                  removeTier(tier.id)
                }}
                onMove={(direction) => {
                  reorderTier(index, index + direction)
                }}
                onSort={(order) => {
                  sortTier(tier.id, order)
                }}
                canMoveUp={index > 0}
                canMoveDown={index < view.tiers.length - 1}
                canRemove={view.tiers.length > 1}
              />
            ))
          )}

          {hasItems ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="mt-0.5 self-start"
              onClick={() => {
                addTier(view.tiers.length)
              }}
            >
              {t('tier.add')}
            </Button>
          ) : null}
        </div>

        <Bench
          className="shrink-0"
          items={itemsIn(view, view.bench)}
          tileSize={tileSize}
          selection={selection}
          onSelect={select}
          onPickFiles={onPickFiles}
          onAddTiles={onAddTiles}
          onShuffle={shuffle}
        />
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0.9,0.25,1)' }}>
        {activeItem ? (
          <div className="relative rotate-2 scale-105 opacity-95 shadow-2xl shadow-room">
            <TileFace item={activeItem} size={tileSize} />
            {/* Only one tile follows the pointer, so the count says how many move. */}
            {selection.size > 1 && selection.has(activeItem.id) ? (
              <span className="type-mono absolute -top-1.5 -right-1.5 rounded-full bg-preview px-1.5 text-[10px] leading-4 font-bold text-room">
                {selection.size}
              </span>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
