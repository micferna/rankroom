import { describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem, moveItem } from './board'
import { boardFileName, boardToArchive, readBoardFile } from './boardFile'
import { RankRoomError } from './errors'
import { BoardParseError, serializeBoard } from './schema'
import type { Board } from '~/types'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** A base64 payload of `bytes` that does not compress, standing in for a WebP. */
function fakeImage(bytes: number): string {
  const raw = new Uint8Array(bytes)
  let seed = 1
  for (let i = 0; i < bytes; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    raw[i] = seed % 256
  }

  let binary = ''
  for (const byte of raw) binary += String.fromCharCode(byte)
  return `data:image/webp;base64,${btoa(binary)}`
}

function sampleBoard(): Board {
  const board = addItems(createBoard({ title: 'Best synths' }), [
    createItem('Juno 106', PIXEL),
    createItem('Prophet 5'),
  ])
  return moveItem(board, board.bench[0]!, board.tiers[0]!.id, 0)
}

function fileFrom(blob: Blob, name: string): File {
  return new File([blob], name)
}

describe('boardFileName', () => {
  it('slugifies the title', () => {
    expect(boardFileName(sampleBoard(), 'rankroom')).toBe('best-synths.rankroom')
  })

  it('falls back for a title with nothing sluggable in it', () => {
    const board = { ...sampleBoard(), title: '???' }
    expect(boardFileName(board, 'json')).toBe('rankroom.json')
  })
})

describe('the .rankroom archive', () => {
  it('round-trips a board, images included', async () => {
    const board = sampleBoard()
    const restored = await readBoardFile(fileFrom(await boardToArchive(board), 'b.rankroom'))

    expect(restored.title).toBe('Best synths')
    expect(Object.keys(restored.items)).toHaveLength(2)
    expect(restored.tiers[0]!.itemIds).toHaveLength(1)

    const withImage = Object.values(restored.items).find((item) => item.label === 'Juno 106')
    expect(withImage?.image).toMatch(/^data:image\/png;base64,/)
  })

  it('names image files after the tile, so an unzipped archive is browsable', async () => {
    const bytes = new Uint8Array(await (await boardToArchive(sampleBoard())).arrayBuffer())
    const { readArchive } = await import('./archive')
    const names = (await readArchive(bytes)).map((entry) => entry.name)

    expect(names).toContain('board.json')
    expect(names).toContain('images/juno-106.png')
  })

  it('is meaningfully smaller than the JSON for realistically sized images', async () => {
    // A 384px WebP tile is several KB; base64 would add a third on top.
    const board = addItems(
      createBoard({ title: 'Heavy' }),
      Array.from({ length: 12 }, (_, index) => createItem(`Item ${index}`, fakeImage(6_000))),
    )

    const archive = (await boardToArchive(board)).size
    const json = JSON.stringify(serializeBoard(board)).length

    expect(archive).toBeLessThan(json * 0.85)
  })

  it('is larger for tiny images, where per-entry overhead dominates', async () => {
    // Documented rather than fixed: ZIP spends ~150 bytes per file, so it only
    // pays off above roughly 500 bytes an image. Real tiles are far past that.
    const board = addItems(
      createBoard({ title: 'Tiny' }),
      Array.from({ length: 12 }, (_, index) => createItem(`Item ${index}`, PIXEL)),
    )

    expect((await boardToArchive(board)).size).toBeGreaterThan(
      JSON.stringify(serializeBoard(board)).length,
    )
  })

  it('keeps a board with no images at all', async () => {
    const board = addItems(createBoard({ title: 'Text only' }), [
      createItem('One'),
      createItem('Two'),
    ])
    const restored = await readBoardFile(fileFrom(await boardToArchive(board), 'b.rankroom'))

    expect(Object.keys(restored.items)).toHaveLength(2)
    expect(Object.values(restored.items).every((item) => !item.image)).toBe(true)
  })
})

describe('readBoardFile', () => {
  it('opens a plain .json board', async () => {
    const json = JSON.stringify(serializeBoard(sampleBoard()))
    const restored = await readBoardFile(new File([json], 'board.json'))

    expect(restored.title).toBe('Best synths')
    expect(Object.keys(restored.items)).toHaveLength(2)
  })

  it('sniffs the content rather than trusting the extension', async () => {
    // An archive that someone renamed to .json still opens.
    const archive = await boardToArchive(sampleBoard())
    const restored = await readBoardFile(fileFrom(archive, 'renamed.json'))

    expect(restored.title).toBe('Best synths')
  })

  it('rejects an empty file', async () => {
    await expect(readBoardFile(new File([], 'empty.json'))).rejects.toThrow(RankRoomError)
  })

  it('rejects a file that is not JSON', async () => {
    await expect(readBoardFile(new File(['not json'], 'x.json'))).rejects.toThrow(RankRoomError)
  })

  it('rejects valid JSON that is not a board', async () => {
    await expect(readBoardFile(new File(['{"hello":1}'], 'x.json'))).rejects.toThrow(
      BoardParseError,
    )
  })

  it('rejects an archive with no board inside', async () => {
    const { createArchive } = await import('./archive')
    const archive = await createArchive([
      { name: 'readme.txt', bytes: new TextEncoder().encode('hi') },
    ])

    await expect(readBoardFile(fileFrom(archive, 'x.rankroom'))).rejects.toThrow(RankRoomError)
  })

  it('still validates an archived board — a hostile image is dropped', async () => {
    const board = sampleBoard()
    const poisoned = {
      ...(serializeBoard(board) as Record<string, unknown>),
    }
    ;(poisoned.items as { image?: string }[])[0]!.image = 'javascript:alert(1)'

    const restored = await readBoardFile(new File([JSON.stringify(poisoned)], 'x.json'))
    expect(
      Object.values(restored.items).every((item) => !item.image?.startsWith('javascript')),
    ).toBe(true)
  })
})
