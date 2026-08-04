/**
 * A minimal ZIP reader and writer, so a board can travel as one file.
 *
 * Why not a library: the app already depends on `CompressionStream` for share
 * links, which is the only hard part of ZIP. What is left is header layout —
 * about a hundred lines — against ~100 KB of JSZip for a single format we both
 * produce and consume.
 *
 * Written entries are stored (uncompressed) when compression would not help,
 * which is the case for the WebP tiles that dominate an archive; the JSON
 * manifest is deflated. Reading accepts both, so an archive a user rebuilt with
 * their own zip tool still opens.
 */

export interface ArchiveEntry {
  name: string
  bytes: Uint8Array
}

const SIGNATURE = {
  localFile: 0x04034b50,
  centralFile: 0x02014b50,
  endOfDirectory: 0x06054b50,
} as const

const METHOD = { stored: 0, deflate: 8 } as const

/** Beyond this an "archive" is almost certainly not a board. */
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

export class ArchiveError extends Error {
  override readonly name = 'ArchiveError'
}

// --- CRC-32 -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// --- compression ------------------------------------------------------------

function stream(bytes: Uint8Array): ReadableStream<BufferSource> {
  const chunk = new Uint8Array(bytes.length)
  chunk.set(bytes)

  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collect(source: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  const reader = source.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(stream(bytes).pipeThrough(new CompressionStream('deflate-raw')))
}

function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(stream(bytes).pipeThrough(new DecompressionStream('deflate-raw')))
}

// --- writing ----------------------------------------------------------------

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface Staged {
  name: Uint8Array
  method: number
  crc: number
  compressed: Uint8Array
  originalSize: number
  offset: number
}

/**
 * Builds a ZIP. Entries whose name ends in a compressed image extension are
 * stored as-is, because deflating a WebP costs time and gains nothing.
 */
export async function createArchive(entries: readonly ArchiveEntry[]): Promise<Blob> {
  const staged: Staged[] = []
  let offset = 0
  const parts: Uint8Array[] = []

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const alreadyCompressed = /\.(?:webp|png|jpe?g|gif|avif)$/i.test(entry.name)
    const compressed = alreadyCompressed ? entry.bytes : await deflate(entry.bytes)
    const method = alreadyCompressed ? METHOD.stored : METHOD.deflate

    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, SIGNATURE.localFile, true)
    view.setUint16(4, 20, true) // version needed
    view.setUint16(6, 0, true) // flags
    view.setUint16(8, method, true)
    view.setUint16(10, 0, true) // time
    view.setUint16(12, 0, true) // date
    view.setUint32(14, crc32(entry.bytes), true)
    view.setUint32(18, compressed.length, true)
    view.setUint32(22, entry.bytes.length, true)
    view.setUint16(26, name.length, true)
    view.setUint16(28, 0, true) // extra length
    header.set(name, 30)

    staged.push({
      name,
      method,
      crc: crc32(entry.bytes),
      compressed,
      originalSize: entry.bytes.length,
      offset,
    })

    parts.push(header, compressed)
    offset += header.length + compressed.length
  }

  const directoryOffset = offset
  let directorySize = 0

  for (const entry of staged) {
    const record = new Uint8Array(46 + entry.name.length)
    const view = new DataView(record.buffer)
    view.setUint32(0, SIGNATURE.centralFile, true)
    view.setUint16(4, 20, true) // version made by
    view.setUint16(6, 20, true) // version needed
    view.setUint16(8, 0, true)
    view.setUint16(10, entry.method, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.compressed.length, true)
    view.setUint32(24, entry.originalSize, true)
    view.setUint16(28, entry.name.length, true)
    view.setUint16(30, 0, true) // extra
    view.setUint16(32, 0, true) // comment
    view.setUint16(34, 0, true) // disk
    view.setUint16(36, 0, true) // internal attrs
    view.setUint32(38, 0, true) // external attrs
    view.setUint32(42, entry.offset, true)
    record.set(entry.name, 46)

    parts.push(record)
    directorySize += record.length
  }

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, SIGNATURE.endOfDirectory, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, staged.length, true)
  endView.setUint16(10, staged.length, true)
  endView.setUint32(12, directorySize, true)
  endView.setUint32(16, directoryOffset, true)
  endView.setUint16(20, 0, true)
  parts.push(end)

  return new Blob(
    parts.map((part) => part.slice().buffer),
    { type: 'application/zip' },
  )
}

// --- reading ----------------------------------------------------------------

function findEndOfDirectory(view: DataView): number {
  // The record is at the very end unless there is a comment; scan back over the
  // largest comment ZIP allows.
  const limit = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let i = view.byteLength - 22; i >= limit; i -= 1) {
    if (view.getUint32(i, true) === SIGNATURE.endOfDirectory) return i
  }
  throw new ArchiveError('Not a zip file.')
}

/** Reads every entry. Only stored and deflated entries are supported. */
export async function readArchive(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new ArchiveError('That archive is too large.')
  if (bytes.length < 22) throw new ArchiveError('Not a zip file.')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEndOfDirectory(view)
  const count = view.getUint16(end + 10, true)
  let cursor = view.getUint32(end + 16, true)

  const entries: ArchiveEntry[] = []

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== SIGNATURE.centralFile) {
      throw new ArchiveError('This archive is damaged.')
    }

    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)

    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength

    if (
      localOffset + 30 > bytes.length ||
      view.getUint32(localOffset, true) !== SIGNATURE.localFile
    ) {
      throw new ArchiveError('This archive is damaged.')
    }

    // The local header repeats the name and extra lengths, and they can differ
    // from the central directory's — the local values are the ones that locate
    // the data.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    if (method === METHOD.stored) {
      entries.push({ name, bytes: raw.slice() })
    } else if (method === METHOD.deflate) {
      entries.push({ name, bytes: await inflate(raw) })
    } else {
      throw new ArchiveError('This archive uses an unsupported compression method.')
    }
  }

  return entries
}
