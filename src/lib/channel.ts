import type { OverlayMessage } from '~/types'

/**
 * The editor and the overlay talk over BroadcastChannel.
 *
 * A caveat worth stating plainly, because it drives the whole overlay design:
 * OBS's Browser Source runs inside OBS's own embedded browser, a separate
 * process from the creator's Chrome. BroadcastChannel cannot cross that line.
 *
 * So the overlay supports two ways in:
 *   • `#/overlay`          — live, driven by this channel. Use it in a second
 *                            window and capture that window in OBS.
 *   • `#/overlay/<token>`  — the board baked into the URL, no channel needed.
 *                            Paste this straight into a Browser Source.
 *
 * `RankRoomChannel` degrades to a no-op where BroadcastChannel is missing, so
 * the static overlay keeps working regardless.
 */

const CHANNEL_NAME = 'rankroom:overlay'

export interface RankRoomChannel {
  post: (message: OverlayMessage) => void
  close: () => void
  readonly supported: boolean
}

export function createChannel(onMessage?: (message: OverlayMessage) => void): RankRoomChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return { post: () => undefined, close: () => undefined, supported: false }
  }

  const channel = new BroadcastChannel(CHANNEL_NAME)
  if (onMessage) {
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = event.data
      // Same-origin by construction, but shape-check anyway: a stale tab from an
      // older build could be posting a message this one does not understand.
      if (typeof message === 'object' && message !== null && 'type' in message) {
        onMessage(message as OverlayMessage)
      }
    })
  }

  return {
    post: (message) => {
      channel.postMessage(message)
    },
    close: () => {
      channel.close()
    },
    supported: true,
  }
}
