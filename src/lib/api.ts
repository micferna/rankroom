import type { MessageKey } from '~/i18n/en'
import { RankRoomError } from './errors'
import { parseBoard } from './schema'
import type { Board } from '~/types'

/**
 * The client for the optional backend.
 *
 * Optional is the operative word. Without `VITE_API_URL` at build time this
 * module reports `configured === false`, every caller skips it, and the app is
 * exactly what it was before the server existed: boards in the browser, share
 * links that carry themselves, chat read anonymously. Nothing here is on the
 * path of anything that already worked.
 *
 * What the server adds is the handful of things a browser cannot do alone — an
 * identity that survives a new device, a page other people can open, and an
 * overlay OBS can follow live.
 */

/**
 * The API's base URL, prefix included.
 *
 * `/api` when the app is served by the server itself, which is the deployment;
 * `https://api.example.com/api` when the two are split. Paths below are
 * relative to it and do not repeat the prefix — writing `/api` in both places
 * produced `/api/me`, which is the kind of mistake that only shows up
 * against a real server, and did.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** Whether this build knows about a server at all. */
export const configured = BASE !== ''

/**
 * Requests carry cookies, and the session cookie is `HttpOnly` — so the token
 * is never readable from JavaScript, and an XSS cannot steal it. The trade is
 * that the browser attaches it automatically, which is what makes cross-site
 * request forgery a question; serving the app and the API from one origin is
 * what answers it.
 */
const CREDENTIALS: RequestCredentials = 'include'

/** Long enough for a slow phone, short enough that a dead server is obvious. */
const TIMEOUT_MS = 15_000

export interface Account {
  id: string
  login: string
  display_name: string
  avatar_url: string | null
}

export interface CloudBoard {
  id: string
  title: string
  is_public: boolean
  item_count: number
  updated_at: string
}

export interface PublicBoard {
  slug: string
  title: string
  item_count: number
  updated_at: string
}

export interface PublicProfile {
  login: string
  display_name: string
  avatar_url: string | null
  boards: PublicBoard[]
}

/** What the server tells the app about itself, before anyone signs in. */
export interface ServerConfig {
  privacy_contact: string | null
  sign_in: boolean
}

export interface OverlayKey {
  key: string
  url: string
}

/**
 * Maps the server's machine-readable error code to something translatable.
 *
 * The server sends a stable `error` code alongside human prose; the code is
 * what this reads. Prose is for logs and for a developer reading a response by
 * hand — it is written in English on the server and would arrive untranslated.
 */
function messageFor(status: number, code: string): MessageKey {
  if (code === 'quota_exceeded') return 'account.errorQuota'
  if (code === 'storage_exceeded') return 'account.errorStorage'
  if (code === 'sign_in_unavailable') return 'account.errorNoSignIn'
  if (status === 401) return 'account.errorSignedOut'
  if (status === 404) return 'account.errorMissing'
  if (status === 413) return 'account.errorTooLarge'
  if (status === 429) return 'account.errorBusy'
  if (status >= 500) return 'account.errorServer'
  return 'account.errorRequest'
}

/**
 * Sends the request and throws a translatable error on anything but success.
 *
 * `Content-Type: application/json` on every request with a body is not only
 * correctness: it makes the request non-simple, so a browser must send a CORS
 * preflight before it, and a preflight from an origin the server does not know
 * never becomes a request. Same-origin serving already removes that surface;
 * this keeps it removed for anyone who splits the two.
 */
async function send(path: string, init?: RequestInit): Promise<Response> {
  if (!configured) throw new RankRoomError('account.errorNoServer')

  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')

  // `AbortSignal.timeout` rather than a manual timer: it cancels the request
  // itself, so a hung connection does not hold a socket open behind a promise
  // nobody is waiting on any more.
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      credentials: CREDENTIALS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Network failure, DNS, timeout, or the server being down. None of them are
    // distinguishable from the browser, and none of them are the user's fault.
    throw new RankRoomError('account.errorOffline')
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const code =
      body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : ''
    throw new RankRoomError(messageFor(response.status, code))
  }

  return response
}

/** A call that answers with JSON. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>
}

/** A call that answers with nothing, which several of these do. */
async function requestNothing(path: string, init?: RequestInit): Promise<void> {
  await send(path, init)
}

/** Public, unauthenticated, and safe to call before signing in. */
export async function serverConfig(): Promise<ServerConfig> {
  return request<ServerConfig>('/config')
}

// --- session ----------------------------------------------------------------

/** Where the browser goes to sign in. A full navigation: OAuth needs one. */
export function signInUrl(): string {
  return `${BASE}/auth/twitch/start`
}

/**
 * The signed-in account, or null.
 *
 * A 401 is the normal answer for a visitor, not an error worth surfacing — so
 * it resolves to null and the caller shows a sign-in button.
 */
export async function me(): Promise<Account | null> {
  try {
    const body = await request<{ user: Account }>('/me')
    return body.user
  } catch (error) {
    if (error instanceof RankRoomError && error.key === 'account.errorSignedOut') return null
    throw error
  }
}

export async function signOut(): Promise<void> {
  await requestNothing('/auth/logout', { method: 'POST' })
}

/** Deletes the account and everything attached to it. There is no undo. */
export async function deleteAccount(): Promise<void> {
  await requestNothing('/me', { method: 'DELETE' })
}

// --- boards -----------------------------------------------------------------

export async function listBoards(): Promise<CloudBoard[]> {
  const body = await request<{ boards: CloudBoard[] }>('/boards')
  return body.boards
}

export async function createBoard(board: Board, isPublic: boolean): Promise<CloudBoard> {
  return request<CloudBoard>('/boards', {
    method: 'POST',
    body: JSON.stringify({ title: board.title, is_public: isPublic, document: board }),
  })
}

export async function updateBoard(
  id: string,
  board: Board,
  isPublic: boolean,
): Promise<CloudBoard> {
  return request<CloudBoard>(`/boards/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: board.title, is_public: isPublic, document: board }),
  })
}

export async function deleteBoard(id: string): Promise<void> {
  await requestNothing(`/boards/${id}`, { method: 'DELETE' })
}

/**
 * Opens one of your boards.
 *
 * The document goes through the same parser as a file or a share link. It came
 * from a server this app trusts, but "trusted source" is not a reason to skip
 * validation — the parser is what guarantees the shape the rest of the app
 * assumes, whatever the bytes came from.
 */
export async function openBoard(id: string): Promise<Board> {
  const body = await request<{ document: unknown }>(`/boards/${id}`)
  return parseBoard(body.document)
}

// --- history ----------------------------------------------------------------

export interface BoardVersion {
  id: string
  title: string
  item_count: number
  bytes: number
  saved_at: string
}

/**
 * Previous states of one of your boards, newest first.
 *
 * Metadata only — a version list must not download every megabyte of a heavy
 * board to render a column of dates.
 */
export async function versions(boardId: string): Promise<BoardVersion[]> {
  const body = await request<{ versions: BoardVersion[] }>(`/boards/${boardId}/versions`)
  return body.versions
}

/** Puts a previous state back. Itself a save, so it is undoable the same way. */
export async function restoreVersion(boardId: string, versionId: string): Promise<CloudBoard> {
  return request<CloudBoard>(`/boards/${boardId}/versions/${versionId}`, { method: 'POST' })
}

// --- public -----------------------------------------------------------------

export async function profile(login: string): Promise<PublicProfile> {
  return request<PublicProfile>(`/u/${encodeURIComponent(login)}`)
}

export async function publicBoard(slug: string): Promise<{ title: string; board: Board }> {
  const body = await request<{ board: { title: string }; document: unknown }>(
    `/b/${encodeURIComponent(slug)}`,
  )
  return { title: body.board.title, board: parseBoard(body.document) }
}

// --- administration ---------------------------------------------------------

export interface AccountSummary {
  id: string
  login: string
  display_name: string
  is_admin: boolean
  boards: number
  public_boards: number
  bytes: number
  created_at: string
  last_seen_at: string
  suspended_at: string | null
}

export interface AdminOverview {
  usage: { accounts: number; boards: number; bytes: number }
  accounts: AccountSummary[]
  limits: {
    max_accounts: number | null
    storage_quota_bytes: number
    boards_per_account: number
    /** Everything the instance could be asked to store if every account filled up. */
    committed_bytes: number | null
  }
  registration: { mode: 'open' | 'invite' | 'closed'; allowed: string[]; admins: string[] }
}

/**
 * The instance overview, or null when this account is not an administrator.
 *
 * The server answers a non-administrator exactly as it answers a request for a
 * route that does not exist, so "not found" is the ordinary case here and not
 * an error worth showing anybody.
 */
export async function adminOverview(): Promise<AdminOverview | null> {
  try {
    return await request<AdminOverview>('/admin/overview')
  } catch (error) {
    if (error instanceof RankRoomError && error.key === 'account.errorMissing') return null
    throw error
  }
}

export async function setSuspension(id: string, suspended: boolean): Promise<void> {
  await requestNothing(`/admin/users/${id}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ suspended }),
  })
}

// --- overlay ----------------------------------------------------------------

/** Issues a fresh overlay key, which invalidates the previous one at once. */
export async function rotateOverlayKey(): Promise<OverlayKey> {
  return request<OverlayKey>('/overlay/key', { method: 'POST' })
}

/**
 * Subscribes to a streamer's live board.
 *
 * This is the whole reason the server exists. An OBS Browser Source runs in
 * OBS's own browser, a separate process, so `BroadcastChannel` cannot reach it
 * and the overlay has always needed the board baked into its URL. A server-sent
 * event stream crosses that line: paste one URL into OBS once and it follows
 * the board for the rest of the show.
 *
 * The key authenticates on its own, because a Browser Source is a URL in a text
 * field and cannot carry a session.
 */
export function subscribeOverlay(
  key: string,
  handlers: { onBoard: (board: Board) => void; onStatus: (live: boolean) => void },
): () => void {
  const source = new EventSource(`${BASE}/overlay/live?key=${encodeURIComponent(key)}`)

  source.addEventListener('open', () => {
    handlers.onStatus(true)
  })

  source.addEventListener('message', (event: MessageEvent<string>) => {
    try {
      const payload: unknown = JSON.parse(event.data)
      if (payload !== null && typeof payload === 'object' && 'board' in payload) {
        handlers.onBoard(parseBoard(payload.board))
      }
    } catch {
      // One malformed frame is not a reason to tear down a live overlay: the
      // next board update replaces whatever this one would have shown.
    }
  })

  source.addEventListener('error', () => {
    // EventSource reconnects on its own; this only reports the gap.
    handlers.onStatus(false)
  })

  return () => {
    source.close()
  }
}
