import type { Board, CompareResult, CompareRow, Item } from '~/types'

/**
 * Compares two rankings of (mostly) the same things.
 *
 * Boards made independently do not share item ids, so matching falls back to the
 * normalised label. Tier counts differ too, which makes raw tier indices useless:
 * "tier 3 of 4" and "tier 3 of 8" are nowhere near each other. Every position is
 * therefore normalised to 0 (top tier) … 1 (bottom tier) before anything is
 * measured, and distances are reported back in tiers of the larger board.
 */

const HOT_TAKE_LIMIT = 8

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

interface Placement {
  item: Item
  /** Index of the tier holding the item, or null when it is benched. */
  tierIndex: number | null
}

function placements(board: Board): Map<string, Placement> {
  const byId = new Map<string, Placement>()

  for (const item of Object.values(board.items)) {
    byId.set(item.id, { item, tierIndex: null })
  }
  board.tiers.forEach((tier, tierIndex) => {
    for (const itemId of tier.itemIds) {
      const entry = byId.get(itemId)
      if (entry) entry.tierIndex = tierIndex
    }
  })

  return byId
}

function normalisedPosition(tierIndex: number, tierCount: number): number {
  return tierCount <= 1 ? 0 : tierIndex / (tierCount - 1)
}

export function compareBoards(left: Board, right: Board): CompareResult {
  const leftPlacements = placements(left)
  const rightPlacements = placements(right)

  const rightByLabel = new Map<string, string>()
  for (const [id, placement] of rightPlacements) {
    const key = normaliseLabel(placement.item.label)
    if (key && !rightByLabel.has(key)) rightByLabel.set(key, id)
  }

  const scale = Math.max(left.tiers.length, right.tiers.length) - 1
  const matchedRight = new Set<string>()
  const rows: CompareRow[] = []
  let distanceTotal = 0
  let measured = 0
  let exactMatches = 0

  for (const [id, leftPlacement] of leftPlacements) {
    const labelKey = normaliseLabel(leftPlacement.item.label)
    const rightId = rightPlacements.has(id) ? id : labelKey ? rightByLabel.get(labelKey) : undefined
    const rightPlacement = rightId !== undefined ? rightPlacements.get(rightId) : undefined
    if (rightId !== undefined && rightPlacement) matchedRight.add(rightId)

    let gap: number | null = null
    if (leftPlacement.tierIndex !== null && rightPlacement?.tierIndex != null) {
      const distance = Math.abs(
        normalisedPosition(leftPlacement.tierIndex, left.tiers.length) -
          normalisedPosition(rightPlacement.tierIndex, right.tiers.length),
      )
      distanceTotal += distance
      measured += 1
      if (distance === 0) exactMatches += 1
      gap = distance * Math.max(1, scale)
    }

    rows.push({
      itemId: id,
      label: leftPlacement.item.label,
      ...(leftPlacement.item.image ? { image: leftPlacement.item.image } : {}),
      left: leftPlacement.tierIndex,
      right: rightPlacement?.tierIndex ?? null,
      gap,
    })
  }

  for (const [id, rightPlacement] of rightPlacements) {
    if (matchedRight.has(id)) continue
    rows.push({
      itemId: id,
      label: rightPlacement.item.label,
      ...(rightPlacement.item.image ? { image: rightPlacement.item.image } : {}),
      left: null,
      right: rightPlacement.tierIndex,
      gap: null,
    })
  }

  const shared = matchedRight.size
  const hotTakes = rows
    .filter((row): row is CompareRow & { gap: number } => row.gap !== null && row.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, HOT_TAKE_LIMIT)

  return {
    rows,
    agreement: measured === 0 ? 0 : 1 - distanceTotal / measured,
    exactMatches,
    measured,
    shared,
    onlyLeft: leftPlacements.size - shared,
    onlyRight: rightPlacements.size - shared,
    hotTakes,
  }
}
