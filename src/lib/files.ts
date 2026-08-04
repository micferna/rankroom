import { isAcceptedImage } from './image'

/**
 * Pulling files out of a drop, including whole folders.
 *
 * The plain `DataTransfer.files` list is empty for a dropped directory — you
 * only get one entry, and it has no size. Walking `webkitGetAsEntry()` is the
 * only way to reach the contents, and it is what makes "drag your covers folder
 * in" work at all. It is a non-standard API, but it is the one every browser
 * implements.
 */

/**
 * The entries API is non-standard, so it is feature-detected once rather than
 * optional-chained at every call — TypeScript's DOM lib declares it as always
 * present, which is not true of every engine this runs in.
 */
const SUPPORTS_ENTRIES =
  typeof DataTransferItem !== 'undefined' && 'webkitGetAsEntry' in DataTransferItem.prototype

/** A dropped folder deeper than this is almost certainly not a pile of covers. */
const MAX_DEPTH = 4
/** Hard stop, so a mis-drop of a huge tree cannot hang the tab. */
const MAX_FILES = 600

interface FileSystemEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (onSuccess: (file: File) => void, onError: (error: unknown) => void) => void
  createReader?: () => {
    readEntries: (
      onSuccess: (entries: FileSystemEntryLike[]) => void,
      onError: (error: unknown) => void,
    ) => void
  }
}

function readFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null)
      return
    }
    entry.file(resolve, () => {
      resolve(null)
    })
  })
}

/** `readEntries` returns at most 100 per call, so it has to be drained. */
function readDirectory(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.()
  if (!reader) return Promise.resolve([])

  return new Promise((resolve) => {
    const all: FileSystemEntryLike[] = []

    const next = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all)
            return
          }
          all.push(...batch)
          if (all.length >= MAX_FILES) {
            resolve(all)
            return
          }
          next()
        },
        () => {
          resolve(all)
        },
      )
    }

    next()
  })
}

async function walk(entry: FileSystemEntryLike, depth: number, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES) return

  if (entry.isFile) {
    const file = await readFile(entry)
    if (file && isAcceptedImage(file)) out.push(file)
    return
  }

  if (entry.isDirectory && depth < MAX_DEPTH) {
    const children = await readDirectory(entry)
    // Alphabetical, so "01-…, 02-…" lands on the bench in the order the user
    // numbered it rather than in whatever order the filesystem replied.
    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const child of children) await walk(child, depth + 1, out)
  }
}

/**
 * Every image in a drop, descending into folders.
 * Falls back to the flat file list where the entries API is unavailable.
 */
export async function imagesFromDrop(transfer: DataTransfer | null): Promise<File[]> {
  if (!transfer) return []

  if (!SUPPORTS_ENTRIES) return Array.from(transfer.files).filter(isAcceptedImage)

  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry() as FileSystemEntryLike | null)
    .filter((entry): entry is FileSystemEntryLike => entry !== null)

  if (entries.length === 0) {
    return Array.from(transfer.files).filter(isAcceptedImage)
  }

  const files: File[] = []
  for (const entry of entries) await walk(entry, 0, files)
  return files
}

/** True when the drop contains at least one directory, for the drop hint. */
export function dropHasFolder(transfer: DataTransfer | null): boolean {
  if (!transfer || !SUPPORTS_ENTRIES) return false
  return Array.from(transfer.items).some(
    (item) => item.kind === 'file' && item.webkitGetAsEntry()?.isDirectory === true,
  )
}

/** The single non-image file in a drop, if that is what this drop is. */
export function boardFileFromDrop(transfer: DataTransfer | null): File | null {
  if (!transfer) return null

  const files = Array.from(transfer.files)
  if (files.length !== 1) return null

  const file = files[0]
  if (!file || isAcceptedImage(file)) return null
  return /\.(?:json|rankroom)$/i.test(file.name) ? file : null
}
