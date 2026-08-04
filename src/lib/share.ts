import type { Board } from '~/types'
import { resetPlacements } from './board'
import { BoardParseError, parseBoard, serializeBoard } from './schema'

/**
 * Share links carry the whole board in the URL fragment — nothing is uploaded,
 * and the fragment never reaches a server. Payloads are deflate-raw compressed
 * and base64url encoded; the leading two characters are a format tag so the
 * decoder can stay compatible with links minted by older builds.
 */

const TAG_DEFLATE = '1z'
const TAG_PLAIN = '1u'

/** Marks a board whose placements were deliberately stripped. */
export const BLIND_MARKER = 'blind'

/** Beyond this, links start breaking in chat clients that wrap or truncate URLs. */
export const SHARE_SIZE_WARNING = 12_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked to stay well under the argument-count limit on large payloads.
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function supportsCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  const reader = stream.getReader()
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

/**
 * A one-chunk stream over the bytes. Going through `Blob.stream()` would be
 * shorter, but Blob is not streamable everywhere the codec runs (jsdom, older
 * WebViews) whereas ReadableStream is a hard requirement of the codec anyway.
 */
function byteStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  // Copied into a fresh buffer so the chunk is a plain (never shared)
  // ArrayBuffer, which is what the compression streams accept.
  const chunk = new Uint8Array(bytes.length)
  chunk.set(bytes)

  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(byteStream(bytes).pipeThrough(new CompressionStream('deflate-raw')))
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(byteStream(bytes).pipeThrough(new DecompressionStream('deflate-raw')))
}

export interface EncodeOptions {
  images?: boolean
  /**
   * Strips every placement, so the receiver ranks the same items without seeing
   * your answer. The comparison afterwards is the whole point of the format.
   */
  blind?: boolean
}

export async function encodeBoard(board: Board, options: EncodeOptions = {}): Promise<string> {
  const source = options.blind ? blindBoard(board) : board
  const json = JSON.stringify(serializeBoard(source, options))
  const bytes = encoder.encode(json)

  if (!supportsCompression()) return TAG_PLAIN + toBase64Url(bytes)
  return TAG_DEFLATE + toBase64Url(await deflate(bytes))
}

export async function decodeBoard(token: string): Promise<Board> {
  const tag = token.slice(0, 2)
  const payload = token.slice(2)
  if (!payload) throw new BoardParseError('error.share.empty')

  let json: string
  try {
    const bytes = fromBase64Url(payload)
    if (tag === TAG_DEFLATE) {
      json = decoder.decode(await inflate(bytes))
    } else if (tag === TAG_PLAIN) {
      json = decoder.decode(bytes)
    } else {
      throw new BoardParseError('error.share.format')
    }
  } catch (error) {
    if (error instanceof BoardParseError) throw error
    throw new BoardParseError('error.share.damaged')
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new BoardParseError('error.share.damaged')
  }

  return parseBoard(raw)
}

/**
 * The same board with nothing ranked, and a marker the opener can recognise.
 * The marker rides in the subtitle rather than a new schema field so an older
 * build still opens the link — it just shows an unranked board, which is the
 * honest degradation.
 */
function blindBoard(board: Board): Board {
  return {
    ...resetPlacements(board),
    subtitle: board.subtitle ? `${board.subtitle} · ${BLIND_MARKER}` : BLIND_MARKER,
  }
}

/** True when a board arrived through a blind-ranking link. */
export function isBlindBoard(board: Board): boolean {
  return board.subtitle.trim().endsWith(BLIND_MARKER)
}

/** The board with the marker taken back out, ready to edit. */
export function withoutBlindMarker(board: Board): Board {
  const subtitle = board.subtitle.replace(new RegExp(`\\s*·?\\s*${BLIND_MARKER}$`), '').trim()
  return { ...board, subtitle }
}

/** Absolute link that reopens the board, images included when they fit. */
export function shareUrl(token: string, origin = window.location.href): string {
  const url = new URL(origin)
  url.hash = `#/b/${token}`
  url.search = ''
  return url.toString()
}

/** Reads the `#/b/<token>` fragment, if the current URL carries one. */
export function readShareToken(hash: string): string | null {
  const match = /^#\/b\/([A-Za-z0-9\-_]+)$/.exec(hash)
  return match?.[1] ?? null
}
