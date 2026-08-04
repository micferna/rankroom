import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import { useUiStore } from '~/store/uiStore'
import { Icon } from './Icon'

const TONE = {
  info: 'border-edge text-chalk',
  good: 'border-preview/40 text-preview',
  bad: 'border-program/45 text-program',
} as const

export function Toasts() {
  const t = useT()
  const toasts = useUiStore((state) => state.toasts)
  const dismiss = useUiStore((state) => state.dismiss)

  return (
    <div
      // Assertive would interrupt a screen reader mid-sentence for a confirmation.
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'animate-rise pointer-events-auto flex items-center gap-3 rounded-control border bg-desk px-3 py-2 text-sm shadow-lg shadow-room/50',
            TONE[toast.tone],
          )}
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            aria-label={t('action.dismiss')}
            className="text-slate transition-colors hover:text-chalk"
            onClick={() => {
              dismiss(toast.id)
            }}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
