import { describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem, moveItem } from './board'
import { BoardParseError } from './schema'
import { decodeBoard, encodeBoard, readShareToken } from './share'

function sampleBoard() {
  const board = addItems(createBoard({ title: 'Best synths' }), [
    createItem('Juno 106'),
    createItem('Prophet 5'),
  ])
  return moveItem(board, board.bench[0]!, board.tiers[0]!.id, 0)
}

describe('encodeBoard / decodeBoard', () => {
  it('round-trips a board through a share token', async () => {
    const board = sampleBoard()
    const restored = await decodeBoard(await encodeBoard(board))

    expect(restored.title).toBe('Best synths')
    expect(Object.keys(restored.items)).toHaveLength(2)
    expect(restored.tiers[0]!.itemIds).toHaveLength(1)
  })

  it('produces a URL-safe token', async () => {
    const token = await encodeBoard(sampleBoard())
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('compresses repetitive boards well below the raw JSON size', async () => {
    const board = addItems(
      createBoard({ title: 'Repetition' }),
      Array.from({ length: 60 }, () => createItem('the same label over and over')),
    )

    const token = await encodeBoard(board)
    expect(token.length).toBeLessThan(JSON.stringify(board).length / 2)
  })

  it('rejects a token with an unknown format tag', async () => {
    await expect(decodeBoard('99abcdef')).rejects.toThrow(BoardParseError)
  })

  it('rejects an empty token', async () => {
    await expect(decodeBoard('1z')).rejects.toThrow(BoardParseError)
  })

  it('rejects a corrupted payload without leaking an internal error', async () => {
    const token = await encodeBoard(sampleBoard())
    const damaged = `${token.slice(0, -8)}AAAAAAAA`

    await expect(decodeBoard(damaged)).rejects.toThrow(BoardParseError)
  })
})

describe('readShareToken', () => {
  it('reads a board fragment', () => {
    expect(readShareToken('#/b/1zAbc-_')).toBe('1zAbc-_')
  })

  it('ignores anything else', () => {
    for (const hash of ['', '#/', '#/overlay', '#/b/', '#/b/has spaces', '#/b/a/b']) {
      expect(readShareToken(hash)).toBeNull()
    }
  })
})
