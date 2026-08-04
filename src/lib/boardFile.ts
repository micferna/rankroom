import type { Board, Item } from '~/types'
import { createArchive, readArchive, type ArchiveEntry } from './archive'
import { slugify } from './download'
import { RankRoomError } from './errors'
import { parseBoard, serializeBoard } from './schema'

/**
 * Reading and writing a board as a file.
 *
 * Two formats, on purpose:
 *
 *   • `.json`  — one readable file, images inline as data URLs. Diffable, easy
 *                to hand-edit, and what most people expect from "export data".
 *   • `.rankroom` — a zip holding `board.json` plus `images/` as real files.
 *                Roughly a quarter smaller than the JSON for real tiles, because
 *                base64 costs 33% and ZIP only ~150 bytes a file — the two cross
 *                over around 500 bytes an image, well below any real one. You can
 *                also just unzip it and get your pictures back as pictures.
 *
 * Opening accepts either, and sniffs the content rather than trusting the
 * extension — people rename files.
 */

const MANIFEST = 'board.json'
const IMAGE_DIR = 'images/'
const ZIP_MAGIC = [0x50, 0x4b] as const

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Extension for the data URL's media type, e.g. "data:image/webp;base64,…". */
function extensionOf(dataUrl: string): string {
  const match = /^data:image\/([a-z+]+);base64,/i.exec(dataUrl)
  const subtype = match?.[1]?.toLowerCase()
  if (!subtype) return 'bin'
  return subtype === 'jpeg' ? 'jpg' : subtype
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function boardFileName(board: Board, extension: 'json' | 'rankroom'): string {
  return `${slugify(board.title)}.${extension}`
}

/**
 * Packs a board into a `.rankroom` archive.
 *
 * Images move out of the JSON and into real files named after the tile, so an
 * unzipped archive is browsable: `images/dune-part-two.webp`, not `images/3.bin`.
 */
export async function boardToArchive(board: Board): Promise<Blob> {
  const entries: ArchiveEntry[] = []
  const used = new Set<string>()
  const items: Record<string, string> = {}

  for (const item of Object.values(board.items)) {
    if (!item.image) continue

    const [, payload] = item.image.split(',')
    if (!payload) continue

    // Names collide as soon as two tiles share a label; the id breaks the tie.
    let name = `${IMAGE_DIR}${slugify(item.label, item.id)}.${extensionOf(item.image)}`
    if (used.has(name))
      name = `${IMAGE_DIR}${slugify(item.label, item.id)}-${item.id}.${extensionOf(item.image)}`
    used.add(name)

    items[item.id] = name
    entries.push({ name, bytes: decodeBase64(payload) })
  }

  const manifest = {
    ...(serializeBoard(board, { images: false }) as Record<string, unknown>),
    // Where each tile's picture went, so the reader can put them back.
    imageFiles: items,
  }

  entries.unshift({ name: MANIFEST, bytes: encoder.encode(JSON.stringify(manifest, null, 2)) })
  return createArchive(entries)
}

function mediaTypeFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'gif') return 'image/gif'
  return 'image/webp'
}

async function boardFromArchive(bytes: Uint8Array): Promise<Board> {
  const entries = await readArchive(bytes)
  const manifest = entries.find((entry) => entry.name === MANIFEST)
  if (!manifest) throw new RankRoomError('file.noManifest')

  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(manifest.bytes))
  } catch {
    throw new RankRoomError('file.unreadable')
  }

  const files = new Map(entries.map((entry) => [entry.name, entry.bytes]))
  const record = raw as { imageFiles?: Record<string, string>; items?: unknown }

  // Fold the image files back into the items before validation, so the parser
  // still sees — and still polices — a plain board.
  if (record.imageFiles && Array.isArray(record.items)) {
    for (const item of record.items as Item[]) {
      const path = record.imageFiles[item.id]
      const bytes = path ? files.get(path) : undefined
      if (bytes) item.image = `data:${mediaTypeFor(path ?? '')};base64,${encodeBase64(bytes)}`
    }
  }

  return parseBoard(raw)
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1]
}

/**
 * Opens a board from a file the user picked, whatever the extension says.
 * Throws a `RankRoomError` or `BoardParseError`, both of which carry a
 * translatable key.
 */
export async function readBoardFile(file: File): Promise<Board> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) throw new RankRoomError('file.empty')

  if (looksLikeZip(bytes)) return boardFromArchive(bytes)

  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new RankRoomError('file.unreadable')
  }
  return parseBoard(raw)
}
