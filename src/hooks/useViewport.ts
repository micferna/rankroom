import { useSyncExternalStore } from 'react'

export interface Viewport {
  width: number
  height: number
}

let snapshot: Viewport = { width: 0, height: 0 }

function read(): Viewport {
  if (snapshot.width !== window.innerWidth || snapshot.height !== window.innerHeight) {
    snapshot = { width: window.innerWidth, height: window.innerHeight }
  }
  // Cached so useSyncExternalStore sees a stable reference between resizes.
  return snapshot
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
  }
}

const SERVER_SNAPSHOT: Viewport = { width: 1280, height: 800 }

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, read, () => SERVER_SNAPSHOT)
}

/**
 * Largest square that fits `share` of both axes, clamped.
 *
 * The stage surfaces — duel cards, the stream deck — show one big tile and the
 * controls under it. Sizing from the viewport keeps both on screen instead of
 * pushing the buttons below the fold on a laptop or a phone.
 */
export function stageTileSize(viewport: Viewport, share: number, max: number): number {
  const fromWidth = viewport.width * share
  const fromHeight = viewport.height * share
  return Math.max(88, Math.min(max, Math.round(Math.min(fromWidth, fromHeight))))
}

/**
 * Tile size for a viewport when the user has not chosen one.
 *
 * A tier list is scanned as a whole, so the target is "how many fit in a row",
 * not "how big is a tile": roughly five on a phone, ten on a laptop. The steps
 * are hand-picked rather than a formula because the row also carries a tier
 * slug, and a smooth curve produced awkward sizes in the middle.
 */
export function autoTileSize(width: number): number {
  if (width < 420) return 48
  if (width < 640) return 56
  if (width < 1024) return 64
  if (width < 1536) return 76
  return 84
}

/** The tile size to render: the user's choice, or the viewport-derived default. */
export function useTileSize(preference: number | 'auto'): number {
  const { width } = useViewport()
  return preference === 'auto' ? autoTileSize(width) : preference
}
