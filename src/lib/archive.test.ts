import { describe, expect, it } from 'vitest'
import { ArchiveError, createArchive, crc32, readArchive } from './archive'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('crc32', () => {
  it('matches the published check value', () => {
    // The standard CRC-32 of "123456789" is 0xCBF43926.
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('createArchive / readArchive', () => {
  it('round-trips a text entry', async () => {
    const archive = await createArchive([{ name: 'board.json', bytes: encoder.encode('{"a":1}') }])
    const [entry] = await readArchive(await bytesOf(archive))

    expect(entry?.name).toBe('board.json')
    expect(decoder.decode(entry?.bytes)).toBe('{"a":1}')
  })

  it('round-trips several entries, preserving order and content', async () => {
    const input = [
      { name: 'board.json', bytes: encoder.encode('{"schema":1}') },
      { name: 'images/a.webp', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      { name: 'images/b.webp', bytes: new Uint8Array([9, 8, 7]) },
    ]

    const entries = await readArchive(await bytesOf(await createArchive(input)))

    expect(entries.map((entry) => entry.name)).toEqual(input.map((entry) => entry.name))
    entries.forEach((entry, index) => {
      expect([...entry.bytes]).toEqual([...input[index]!.bytes])
    })
  })

  it('starts with the ZIP magic number, so it opens in any unzip tool', async () => {
    const bytes = await bytesOf(
      await createArchive([{ name: 'a.txt', bytes: encoder.encode('x') }]),
    )
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b])
  })

  it('deflates text but stores already-compressed images', async () => {
    const repetitive = encoder.encode('a'.repeat(5000))
    const asJson = await bytesOf(await createArchive([{ name: 'a.json', bytes: repetitive }]))
    const asWebp = await bytesOf(await createArchive([{ name: 'a.webp', bytes: repetitive }]))

    expect(asJson.length).toBeLessThan(repetitive.length)
    expect(asWebp.length).toBeGreaterThan(repetitive.length)
  })

  it('handles an empty archive', async () => {
    expect(await readArchive(await bytesOf(await createArchive([])))).toEqual([])
  })

  it('handles an entry with empty content', async () => {
    const entries = await readArchive(
      await bytesOf(await createArchive([{ name: 'empty.bin', bytes: new Uint8Array(0) }])),
    )
    expect(entries[0]?.bytes).toHaveLength(0)
  })

  it('keeps binary content byte-exact, including zeroes', async () => {
    const bytes = new Uint8Array(512)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256

    const entries = await readArchive(
      await bytesOf(await createArchive([{ name: 'x.webp', bytes }])),
    )
    expect([...entries[0]!.bytes]).toEqual([...bytes])
  })

  it('rejects something that is not a zip', async () => {
    await expect(readArchive(encoder.encode('this is not a zip file at all'))).rejects.toThrow(
      ArchiveError,
    )
  })

  it('rejects a truncated file', async () => {
    await expect(readArchive(new Uint8Array([0x50, 0x4b, 0x03]))).rejects.toThrow(ArchiveError)
  })

  it('rejects an archive whose directory points nowhere', async () => {
    const bytes = await bytesOf(
      await createArchive([{ name: 'a.txt', bytes: encoder.encode('x') }]),
    )
    const view = new DataView(bytes.buffer)
    // Corrupt the central-directory offset in the end-of-directory record.
    view.setUint32(bytes.length - 22 + 16, 9999, true)

    await expect(readArchive(bytes)).rejects.toThrow(ArchiveError)
  })
})
