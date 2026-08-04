import type { ClientRect, KeyboardCoordinateGetter } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/**
 * Keyboard navigation that matches the shape of a tier list.
 *
 * dnd-kit's sortable coordinate getter moves between *sortable items*, so on a
 * fresh board — where every tier is empty — a keyboard user could pick a tile up
 * and never put it anywhere. There was nothing above to navigate to.
 *
 * This getter takes over the vertical axis and steps between *zones* instead:
 * up and down change tier, left and right still reorder within one. That is
 * also the better mental model — rows are the vertical structure of a tier
 * list, tiles the horizontal one.
 */

/** Marks the droppables that are rows rather than tiles. */
export const ZONE_DATA = { type: 'zone' } as const

function isZone(data: { current?: Record<string, unknown> | undefined } | undefined): boolean {
  return data?.current?.type === ZONE_DATA.type
}

function centreY(rect: ClientRect): number {
  return rect.top + rect.height / 2
}

export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { currentCoordinates, context } = args
  const { collisionRect, droppableContainers, droppableRects } = context

  const up = event.code === 'ArrowUp'
  const down = event.code === 'ArrowDown'
  if ((!up && !down) || !collisionRect) return sortableKeyboardCoordinates(event, args)

  const zones = droppableContainers
    .toArray()
    .filter((container) => isZone(container.data))
    .map((container) => droppableRects.get(container.id))
    .filter((rect): rect is ClientRect => rect !== undefined)
    .sort((a, b) => a.top - b.top)

  if (zones.length === 0) return sortableKeyboardCoordinates(event, args)

  const from = centreY(collisionRect)
  // The next zone whose centre is genuinely past the dragged tile, so a tall row
  // does not swallow the move.
  const candidates = up
    ? zones.filter((rect) => centreY(rect) < from - 1).reverse()
    : zones.filter((rect) => centreY(rect) > from + 1)

  const target = candidates[0]
  if (!target) return undefined

  return {
    x: currentCoordinates.x,
    y: currentCoordinates.y + (centreY(target) - from),
  }
}
