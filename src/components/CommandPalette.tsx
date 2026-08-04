import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import { Icon, type IconName } from './ui/Icon'

export interface Command {
  id: string
  label: string
  hint?: string
  icon: IconName
  group: string
  keys?: string
  run: () => void
  disabled?: boolean
}

interface CommandPaletteProps {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/** Subsequence match, so "sthum" finds "Save thumbnail". */
function matches(query: string, value: string): boolean {
  if (!query) return true

  const haystack = value.toLowerCase()
  let cursor = 0
  for (const char of query.toLowerCase()) {
    cursor = haystack.indexOf(char, cursor)
    if (cursor === -1) return false
    cursor += 1
  }
  return true
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const t = useT()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const results = useMemo(
    () =>
      commands.filter(
        (command) => !command.disabled && matches(query, `${command.group} ${command.label}`),
      ),
    [commands, query],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      setQuery('')
      setCursor(0)
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const run = (command: Command | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
      className="panel mx-auto mt-[12vh] w-[min(94vw,34rem)] overflow-hidden p-0 text-chalk backdrop:bg-room/80 backdrop:backdrop-blur-sm open:animate-rise"
    >
      <div className="flex items-center gap-2 border-b border-edge px-3">
        <Icon name="search" size={15} className="text-slate" />
        <input
          autoFocus
          value={query}
          placeholder={t('palette.search')}
          aria-label={t('palette.search')}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((index) => Math.min(index + 1, results.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((index) => Math.max(index - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              run(results[cursor])
            }
          }}
          className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate/60"
        />
        <kbd className="kbd">Esc</kbd>
      </div>

      <ul className="max-h-[52dvh] overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-slate">{t('palette.noMatch')}</li>
        ) : (
          results.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                onMouseEnter={() => {
                  setCursor(index)
                }}
                onClick={() => {
                  run(command)
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors',
                  index === cursor ? 'bg-preview/12 text-chalk' : 'text-slate hover:text-chalk',
                )}
              >
                <Icon name={command.icon} size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-chalk">{command.label}</span>
                  {command.hint ? (
                    <span className="block truncate text-[11px]">{command.hint}</span>
                  ) : null}
                </span>
                <span className="type-mono shrink-0 text-[10px] opacity-60">{command.group}</span>
                {command.keys ? <kbd className="kbd shrink-0">{command.keys}</kbd> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </dialog>
  )
}
