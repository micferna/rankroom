import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** "mod" is ⌘ on Apple hardware and Ctrl everywhere else. */
function describe(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)
  return parts.join('+')
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING_TAGS.has(target.tagName) || target.isContentEditable
}

/**
 * Binds a keymap for as long as the component is mounted.
 *
 * Shortcuts stay inert while the user is typing, except for the ones that carry
 * a modifier — Escape and ⌘K have to work from inside a text field.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  // The listener is registered once and reads the latest map through this ref,
  // so re-binding the window on every keystroke-driven re-render is avoided.
  const latest = useRef(map)
  useEffect(() => {
    latest.current = map
  })

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const combo = describe(event)
      const handler = latest.current[combo]
      if (!handler) return

      const bare = !event.ctrlKey && !event.metaKey && !event.altKey
      if (isTyping(event.target) && bare && event.key !== 'Escape') return

      event.preventDefault()
      handler(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enabled])
}

/** Renders "⌘K" on Apple hardware and "Ctrl K" elsewhere. */
export function modLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'
}
