import type { MessageKey } from '~/i18n/en'

/**
 * An error whose message is a translation key.
 *
 * Anything a user might read has to be translatable, and the library layer does
 * not know the active locale — so it names the message and lets the UI render it.
 */
export class RankRoomError extends Error {
  override readonly name = 'RankRoomError'
  readonly key: MessageKey
  readonly params: Record<string, string | number> | undefined

  constructor(key: MessageKey, params?: Record<string, string | number>) {
    super(key)
    this.key = key
    this.params = params
  }
}

/** Narrows anything thrown to a translatable key, with a fallback. */
export function errorKey(error: unknown, fallback: MessageKey): MessageKey {
  if (error instanceof RankRoomError) return error.key
  if (error !== null && typeof error === 'object' && 'key' in error) {
    const key = error.key
    if (typeof key === 'string') return key as MessageKey
  }
  return fallback
}

export function errorParams(error: unknown): Record<string, string | number> | undefined {
  if (error !== null && typeof error === 'object' && 'params' in error) {
    const params = error.params
    if (params && typeof params === 'object') return params as Record<string, string | number>
  }
  return undefined
}
