/**
 * Read-only Twitch chat, straight from the browser.
 *
 * Twitch's IRC gateway accepts anonymous connections: authenticate as
 * `justinfan<random>` and you get every message in a channel without an OAuth
 * flow, an app registration, or a server of your own. The endpoint is `wss://`,
 * so it works from an HTTPS page like GitHub Pages.
 *
 * Nothing is ever sent to the channel — this client only listens.
 */

const ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export type ChatStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface ChatMessage {
  /** Twitch login name, lowercase. Used to keep one vote per viewer. */
  user: string
  /** Display name as the viewer set it, when the tags carry one. */
  display: string
  text: string
  at: number
}

export interface ChatConnection {
  close: () => void
}

export interface ChatHandlers {
  onMessage: (message: ChatMessage) => void
  onStatus: (status: ChatStatus, detail?: string) => void
}

/** Channel names are a login: letters, digits and underscores. */
export function isValidChannel(channel: string): boolean {
  return /^[a-zA-Z0-9_]{3,25}$/.test(channel.trim().replace(/^#/, ''))
}

/**
 * Parses one IRC line into a chat message.
 *
 * Exported for tests: the tag/prefix grammar is fiddly enough that it deserves
 * its own coverage rather than being verified by connecting to Twitch.
 */
export function parsePrivmsg(line: string): ChatMessage | null {
  let rest = line
  let display = ''

  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ')
    if (end === -1) return null
    const tags = rest.slice(1, end)
    rest = rest.slice(end + 1)

    for (const pair of tags.split(';')) {
      const [key, value] = pair.split('=')
      if (key === 'display-name' && value) display = value
    }
  }

  if (!rest.startsWith(':')) return null
  const prefixEnd = rest.indexOf(' ')
  if (prefixEnd === -1) return null

  const prefix = rest.slice(1, prefixEnd)
  const user = prefix.split('!')[0]?.toLowerCase()
  if (!user) return null

  rest = rest.slice(prefixEnd + 1)
  if (!rest.startsWith('PRIVMSG ')) return null

  const textStart = rest.indexOf(' :')
  if (textStart === -1) return null

  const text = rest.slice(textStart + 2)
  return { user, display: display || user, text, at: Date.now() }
}

/**
 * Connects and keeps the connection alive, reconnecting with exponential
 * backoff. Returns a handle whose `close()` stops reconnecting for good.
 */
export function connectTwitchChat(channel: string, handlers: ChatHandlers): ChatConnection {
  const name = channel.trim().replace(/^#/, '').toLowerCase()
  let socket: WebSocket | null = null
  let attempt = 0
  let closed = false
  let retryTimer: number | undefined

  const open = () => {
    if (closed) return
    handlers.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(ENDPOINT)
    } catch {
      handlers.onStatus('error')
      return
    }
    socket = ws

    ws.addEventListener('open', () => {
      // Tags carry the display name; anonymous auth needs no real token.
      ws.send('CAP REQ :twitch.tv/tags')
      ws.send('PASS SCHMOOPIIE')
      ws.send(`NICK justinfan${String(Math.floor(Math.random() * 80_000) + 1_000)}`)
      ws.send(`JOIN #${name}`)
    })

    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') return

      for (const line of event.data.split('\r\n')) {
        if (!line) continue

        if (line.startsWith('PING')) {
          ws.send(line.replace('PING', 'PONG'))
          continue
        }
        // 366 closes the name list, which means the JOIN succeeded.
        if (line.includes(' 366 ')) {
          attempt = 0
          handlers.onStatus('connected')
          continue
        }

        const message = parsePrivmsg(line)
        if (message) handlers.onMessage(message)
      }
    })

    ws.addEventListener('close', () => {
      if (closed) return
      attempt += 1
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS)
      handlers.onStatus('reconnecting')
      retryTimer = window.setTimeout(open, delay)
    })

    ws.addEventListener('error', () => {
      handlers.onStatus(attempt === 0 ? 'error' : 'reconnecting')
    })
  }

  open()

  return {
    close: () => {
      closed = true
      window.clearTimeout(retryTimer)
      socket?.close()
      socket = null
      handlers.onStatus('idle')
    },
  }
}
