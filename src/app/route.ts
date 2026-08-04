import { useSyncExternalStore } from 'react'

/**
 * Hash routing, on purpose.
 *
 * GitHub Pages has no rewrite rules, so a history-API route would 404 on reload.
 * The fragment also keeps shared boards off the wire: `#/b/<token>` is never sent
 * to the server, so a board shared with a friend is not readable by the host.
 */

export interface Route {
  name: 'studio' | 'overlay'
  /** Share token carried by the URL, when the route has one. */
  token: string | null
}

function parse(hash: string): Route {
  const board = /^#\/b\/([A-Za-z0-9\-_]+)$/.exec(hash)
  if (board?.[1]) return { name: 'studio', token: board[1] }

  const overlay = /^#\/overlay(?:\/([A-Za-z0-9\-_]+))?$/.exec(hash)
  if (overlay) return { name: 'overlay', token: overlay[1] ?? null }

  return { name: 'studio', token: null }
}

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

export function overlayUrl(token?: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = token ? `#/overlay/${token}` : '#/overlay'
  return url.toString()
}
