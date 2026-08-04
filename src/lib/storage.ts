import type { Board, Move } from '~/types'
import { parseBoard } from './schema'

/**
 * Boards live in IndexedDB, not localStorage: a board with 60 image tiles is a
 * few megabytes, which blows the 5 MB localStorage budget for the whole origin.
 * Preferences are tiny and synchronous, so they stay in localStorage.
 */

const DB_NAME = 'rankroom'
const DB_VERSION = 1
const BOARD_STORE = 'boards'
const AUTOSAVE_ID = '__autosave__'

export interface StoredBoard {
  id: string
  board: Board
  moves: Move[]
  updatedAt: number
}

export interface BoardSummary {
  id: string
  title: string
  itemCount: number
  rankedCount: number
  updatedAt: number
  /** First few tile images, for the shelf preview. */
  cover: string[]
}

let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOARD_STORE)) {
        db.createObjectStore(BOARD_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('Could not open local storage.'))
    }
  })

  return connection
}

/**
 * Runs one request and resolves with its raw result.
 *
 * The result is `unknown` on purpose: IndexedDB hands back whatever was written,
 * possibly by an older version of this app, so every reader validates.
 */
function run(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<unknown>,
): Promise<unknown> {
  return open().then(
    (db) =>
      new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction(BOARD_STORE, mode)
        const request = work(transaction.objectStore(BOARD_STORE))

        request.onsuccess = () => {
          resolve(request.result)
        }
        request.onerror = () => {
          reject(request.error ?? new Error('Local storage rejected the write.'))
        }
      }),
  )
}

/** Shape check only; `board` itself is validated by `parseBoard`. */
function isRecord(
  value: unknown,
): value is { id: unknown; board: unknown; moves?: unknown; updatedAt?: unknown } {
  return typeof value === 'object' && value !== null && 'id' in value && 'board' in value
}

function toStoredBoard(value: unknown): StoredBoard | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null

  try {
    return {
      id: value.id,
      board: parseBoard(value.board),
      moves: Array.isArray(value.moves) ? (value.moves as Move[]) : [],
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}

async function put(id: string, board: Board, moves: readonly Move[]): Promise<void> {
  const record: StoredBoard = { id, board, moves: [...moves], updatedAt: Date.now() }
  await run('readwrite', (store) => store.put(record) as IDBRequest<unknown>)
}

export function saveBoard(board: Board, moves: readonly Move[]): Promise<void> {
  return put(board.id, board, moves)
}

export function saveAutosave(board: Board, moves: readonly Move[]): Promise<void> {
  return put(AUTOSAVE_ID, board, moves)
}

export async function loadBoard(id: string): Promise<StoredBoard | null> {
  return toStoredBoard(await run('readonly', (store) => store.get(id) as IDBRequest<unknown>))
}

export function loadAutosave(): Promise<StoredBoard | null> {
  return loadBoard(AUTOSAVE_ID)
}

export async function deleteBoard(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id) as IDBRequest<unknown>)
}

export async function listBoards(): Promise<BoardSummary[]> {
  const raw = await run('readonly', (store) => store.getAll() as IDBRequest<unknown>)
  const records = (Array.isArray(raw) ? raw : [])
    .map(toStoredBoard)
    .filter((record): record is StoredBoard => record !== null && record.id !== AUTOSAVE_ID)

  return records
    .map((record) => ({
      id: record.id,
      title: record.board.title,
      itemCount: Object.keys(record.board.items).length,
      rankedCount: record.board.tiers.reduce((total, tier) => total + tier.itemIds.length, 0),
      updatedAt: record.updatedAt,
      cover: record.board.tiers
        .flatMap((tier) => tier.itemIds)
        .slice(0, 5)
        .map((itemId) => record.board.items[itemId]?.image)
        .filter((image): image is string => Boolean(image)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Small, synchronous preferences. Never throws: private mode can block writes. */
export const preferences = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`rankroom:${key}`)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(`rankroom:${key}`, JSON.stringify(value))
    } catch {
      // Storage full or blocked — preferences are a convenience, not a requirement.
    }
  },
}
