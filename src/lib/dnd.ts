import type { Board, ItemId, ZoneId } from '~/types'
import { BENCH } from '~/types'
import { zoneItemIds, zoneOf } from './board'

/**
 * Where a dragged tile should land.
 *
 * This is pure and separate from the component because it is the part that was
 * wrong, and the part that is worth pinning down: "I drop it here and it goes
 * somewhere else" is a decision bug, not a rendering one.
 */

export interface DropTarget {
  zone: ZoneId
  index: number
}

/**
 * The zone an `over` id refers to — a tier or the bench directly, or the zone
 * holding the tile that is being hovered.
 */
export function overZone(board: Board, overId: string): ZoneId | null {
  if (overId === BENCH) return BENCH
  if (board.tiers.some((tier) => tier.id === overId)) return overId
  return zoneOf(board, overId)
}

/**
 * Where to move the tile *while* dragging, or null to leave it alone.
 *
 * Only cross-zone moves are previewed. Reordering inside one zone is left to
 * dnd-kit's sortable strategy, which slides the neighbours aside on its own —
 * doing it here as well created a feedback loop: the tile moved under the
 * cursor, the cursor was then over the tile itself, and every later move was
 * ignored. That is what made a tile impossible to place anywhere but the first
 * slot it happened to land in.
 */
export function previewDrop(board: Board, activeId: ItemId, overId: string): DropTarget | null {
  if (activeId === overId) return null

  const from = zoneOf(board, activeId)
  const to = overZone(board, overId)
  if (from === null || to === null || from === to) return null

  const siblings = zoneItemIds(board, to)
  if (overId === to) return { zone: to, index: siblings.length }

  const index = siblings.indexOf(overId)
  return { zone: to, index: index < 0 ? siblings.length : index }
}

/**
 * Where the tile finally rests on release.
 *
 * Indices follow `arrayMove` semantics — the position of the tile being hovered
 * — which is what `moveItem` produces once it has detached the dragged tile.
 */
export function finalDrop(
  board: Board,
  activeId: ItemId,
  overId: string | null,
): DropTarget | null {
  const zone = zoneOf(board, activeId)
  if (zone === null) return null

  const siblings = zoneItemIds(board, zone)
  const current = siblings.indexOf(activeId)

  // No drop target: the preview already put it where it belongs.
  if (overId === null || overId === activeId) return { zone, index: Math.max(0, current) }

  const target = overZone(board, overId)
  if (target === null || target !== zone) return { zone, index: Math.max(0, current) }

  // Dropped on the row's empty space rather than on a tile: send it to the end.
  if (overId === zone) return { zone, index: Math.max(0, siblings.length - 1) }

  const index = siblings.indexOf(overId)
  return { zone, index: index < 0 ? Math.max(0, current) : index }
}
