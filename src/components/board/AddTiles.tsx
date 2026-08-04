import { useState } from 'react'
import { Icon } from '~/components/ui/Icon'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'

interface AddTilesProps {
  onAdd: (labels: string[]) => void
  className?: string
  placeholder?: string
}

/**
 * Adds text tiles without a browser dialog.
 *
 * Pasting a list adds one tile per line, which is how most people already have
 * their candidates written down — in a notes app, a script, or a chat message.
 */
export function AddTiles({ onAdd, className, placeholder }: AddTilesProps) {
  const t = useT()
  const [value, setValue] = useState('')

  const submit = (raw: string) => {
    const labels = raw
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (labels.length === 0) return
    onAdd(labels)
    setValue('')
  }

  return (
    <form
      className={cx('flex items-center gap-1', className)}
      onSubmit={(event) => {
        event.preventDefault()
        submit(value)
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">{t('bench.addLabel')}</span>
        <input
          value={value}
          placeholder={placeholder ?? t('bench.addPlaceholder')}
          maxLength={800}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain')
            if (!text.includes('\n')) return
            event.preventDefault()
            submit(text)
          }}
          className="w-full rounded-control border border-edge bg-room/60 px-2 py-1 text-xs outline-none placeholder:text-slate/60 focus:border-preview/50"
        />
      </label>
      <button
        type="submit"
        aria-label={t('bench.addSubmit')}
        disabled={!value.trim()}
        className="grid size-6 shrink-0 place-items-center rounded-control bg-rail text-chalk transition-colors hover:bg-rail/70 disabled:opacity-40"
      >
        <Icon name="plus" size={13} />
      </button>
    </form>
  )
}
