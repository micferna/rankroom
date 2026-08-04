import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
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
import { itemsIn, moveItem, zoneItemIds, zoneOf } from '~/lib/board'
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
  selectedId: string | null
  onSelect: (itemId: string | null) => void
  onPickFiles: () => void
  onAddTiles: (labels: string[]) => void
  onBrowseTemplates: () => void
  onPickFolder: () => void
}

function targetZone(board: Board, overId: string): ZoneId | null {
  if (overId === BENCH) return BENCH
  if (board.tiers.some((tier) => tier.id === overId)) return overId
  return zoneOf(board, overId)
}

export function BoardCanvas({
  selectedId,
  onSelect,
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
              zone: zoneName(targetZone(view, String(over.id))),
            })
          : '',
      onDragEnd: ({ active, over }) =>
        over
          ? t('tile.dropped', {
              label: view.items[active.id]?.label ?? t('tile.untitled'),
              zone: zoneName(targetZone(view, String(over.id))),
            })
          : t('tile.dropCancelled'),
      onDragCancel: () => t('tile.dropCancelled'),
    }),
    [view, zoneName, t],
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setDraft(board)
    onSelect(String(event.active.id))
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !draft) return

    const itemId = String(active.id)
    const overId = String(over.id)
    if (itemId === overId) return

    const zone = targetZone(draft, overId)
    if (zone === null) return

    const siblings = zoneItemIds(draft, zone)
    const index = overId === zone ? siblings.length : siblings.indexOf(overId)
    const next = moveItem(draft, itemId, zone, index < 0 ? siblings.length : index)
    if (next !== draft) setDraft(next)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const itemId = String(event.active.id)
    const settled = draft

    setDraft(null)
    setActiveId(null)
    if (!settled) return

    const zone = zoneOf(settled, itemId)
    if (zone === null) return
    place(itemId, zone, zoneItemIds(settled, zone).indexOf(itemId))
  }

  const activeItem = activeId ? view.items[activeId] : undefined
  const hasItems = Object.keys(view.items).length > 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
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
      {/* One scroll area holds the tiers *and* the bench: sticky keeps the bench
          under the content when the board is short, and pinned when it is long. */}
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
              selectedId={selectedId}
              onSelect={onSelect}
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

        <Bench
          className="sticky bottom-0 mt-2"
          items={itemsIn(view, view.bench)}
          tileSize={tileSize}
          selectedId={selectedId}
          onSelect={onSelect}
          onPickFiles={onPickFiles}
          onAddTiles={onAddTiles}
          onShuffle={shuffle}
        />
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0.9,0.25,1)' }}>
        {activeItem ? (
          <div className="rotate-2 scale-105 opacity-95 shadow-2xl shadow-room">
            <TileFace item={activeItem} size={tileSize} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
