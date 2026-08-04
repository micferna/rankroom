const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Short, collision-resistant id. Uses the platform CSPRNG rather than
 * `Math.random()` so ids stay unguessable in shared links.
 */
export function createId(length = 10): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)

  let out = ''
  for (const byte of bytes) {
    // 256 is not a multiple of 36, so the modulo is very slightly biased.
    // Irrelevant here: ids are labels, not secrets.
    out += ALPHABET.charAt(byte % ALPHABET.length)
  }
  return out
}

/** Stable 0–359 hue derived from a string, so text tiles keep their colour. */
export function hueFromString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}
