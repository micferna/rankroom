import { useSyncExternalStore } from 'react'

/**
 * Hash routing, on purpose.
 *
 * The app is served from the root of its own host, so a history-API route would
 * work — but the fragment does something a path cannot: it never reaches a
 * server. `#/b/<token>` carries an entire board, and because browsers do not
 * transmit fragments, not even the host serving the app sees what you ranked.
 * That property is worth more than tidy URLs.
 */

export type RouteName =
  | 'studio'
  /** The OBS overlay: a board baked into the URL, or driven over BroadcastChannel. */
  | 'overlay'
  /** The OBS overlay, following a streamer's board live through the server. */
  | 'overlayLive'
  /** Somebody's public page. */
  | 'profile'
  /** One published board, by its server slug. */
  | 'published'
  /** The account screen. */
  | 'account'

export interface Route {
  name: RouteName
  /**
   * What the route carries: a share token, an overlay key, a login or a slug.
   * Which one depends on `name`, and each consumer knows what it asked for.
   */
  token: string | null
}

/**
 * Order matters, and so does keeping the prefixes apart.
 *
 * `#/b/` was already the share link — a whole board compressed into the
 * fragment — so a server slug arriving there would be handed to the
 * decompressor and fail. Published boards get their own prefix rather than a
 * guess about which kind of string this is.
 */
const PATTERNS: readonly (readonly [RegExp, RouteName])[] = [
  // Ahead of the generic overlay route, which would otherwise read `live` as a
  // share token and try to decompress it.
  [/^#\/overlay\/live\/([A-Za-z0-9\-_]+)$/, 'overlayLive'],
  [/^#\/overlay(?:\/([A-Za-z0-9\-_]+))?$/, 'overlay'],
  [/^#\/u\/([A-Za-z0-9_]{1,25})$/, 'profile'],
  [/^#\/p\/([a-z0-9]{12,32})$/, 'published'],
  [/^#\/account$/, 'account'],
  [/^#\/b\/([A-Za-z0-9\-_]+)$/, 'studio'],
]

function parse(hash: string): Route {
  for (const [pattern, name] of PATTERNS) {
    const match = pattern.exec(hash)
    if (match) return { name, token: match[1] ?? null }
  }
  return { name: 'studio', token: null }
}

/** Exported for tests: the table above is the part worth pinning down. */
export const parseRoute = parse

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  return parse(hash)
}

/** Clears a consumed share token without adding a history entry. */
export function clearHash(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

function appUrl(fragment: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = fragment
  return url.toString()
}

export function overlayUrl(token?: string): string {
  return appUrl(token ? `#/overlay/${token}` : '#/overlay')
}

/** The URL to paste into an OBS Browser Source, which then follows the board. */
export function liveOverlayUrl(key: string): string {
  return appUrl(`#/overlay/live/${key}`)
}

export function profileUrl(login: string): string {
  return appUrl(`#/u/${login}`)
}

export function publishedUrl(slug: string): string {
  return appUrl(`#/p/${slug}`)
}

/** Moves to a route without a reload. */
export function go(fragment: string): void {
  window.location.hash = fragment
}
