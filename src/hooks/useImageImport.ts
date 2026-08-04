import { useCallback, useState } from 'react'
import { createItem } from '~/lib/board'
import { fileToDataUrl, ImageImportError, isAcceptedImage, labelFromFileName } from '~/lib/image'
import { LIMITS } from '~/lib/schema'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { Item } from '~/types'

export interface ImageImport {
  importFiles: (files: readonly File[]) => Promise<void>
  /** Adds one text tile per label; pasting a list is the common case. */
  addTextTiles: (labels: readonly string[]) => void
  /** Number of files still decoding, for progress. */
  pending: number
}

/**
 * Turns dropped, pasted or picked files into tiles.
 *
 * Decoding runs in small batches: a 60-image drop would otherwise hold the main
 * thread long enough to drop frames, and the user sees nothing land until the end.
 */
const BATCH = 6

export function useImageImport(): ImageImport {
  const board = useBoardStore((state) => state.board)
  const addItems = useBoardStore((state) => state.addItems)
  const notify = useUiStore((state) => state.notify)
  const [pending, setPending] = useState(0)

  const importFiles = useCallback(
    async (files: readonly File[]) => {
      const images = files.filter(isAcceptedImage)
      if (images.length === 0) {
        if (files.length > 0) notify('RankRoom takes PNG, JPG, WebP, GIF and AVIF.', 'bad')
        return
      }

      const room = LIMITS.items - Object.keys(board.items).length
      if (room <= 0) {
        notify(`A board holds ${LIMITS.items} tiles. Remove a few before adding more.`, 'bad')
        return
      }

      const accepted = images.slice(0, room)
      if (accepted.length < images.length) {
        notify(`Added the first ${accepted.length} — a board holds ${LIMITS.items} tiles.`, 'bad')
      }

      setPending(accepted.length)
      let failures = 0

      for (let start = 0; start < accepted.length; start += BATCH) {
        const batch = accepted.slice(start, start + BATCH)
        const results = await Promise.all(
          batch.map(async (file): Promise<Item | null> => {
            try {
              return createItem(labelFromFileName(file.name), await fileToDataUrl(file))
            } catch (error) {
              failures += 1
              if (error instanceof ImageImportError && failures === 1) notify(error.message, 'bad')
              return null
            }
          }),
        )

        const items = results.filter((item): item is Item => item !== null)
        if (items.length > 0) addItems(items)
        setPending((count) => Math.max(0, count - batch.length))
      }

      setPending(0)
      const added = accepted.length - failures
      if (added > 0)
        notify(`Added ${added} ${added === 1 ? 'tile' : 'tiles'} to the bench.`, 'good')
    },
    [board.items, addItems, notify],
  )

  const addTextTiles = useCallback(
    (labels: readonly string[]) => {
      const items = labels
        .map((label) => label.trim().slice(0, LIMITS.label))
        .filter(Boolean)
        .slice(0, Math.max(0, LIMITS.items - Object.keys(board.items).length))
        .map((label) => createItem(label))

      if (items.length > 0) addItems(items)
    },
    [addItems, board.items],
  )

  return { importFiles, addTextTiles, pending }
}
