import { useEffect, useRef, type ReactNode } from 'react'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import { IconButton } from './Button'

interface ModalProps {
  open: boolean
  title: string
  /** Short line under the title; leave out when the title is self-explanatory. */
  hint?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}

/**
 * Built on the native <dialog>, which gives focus trapping, Escape handling and
 * inertness of the page behind it without a modal library or a focus-lock hook.
 */
export function Modal({ open, title, hint, onClose, children, footer, size = 'md' }: ModalProps) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // `cancel` fires on Escape; let React own the open state rather than the DOM.
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
    }
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClick={(event) => {
        // Clicks land on the backdrop only when the target is the dialog itself.
        if (event.target === ref.current) onClose()
      }}
      className={cx(
        'panel m-auto w-[min(94vw,var(--modal-w))] max-h-[86dvh] overflow-hidden p-0 text-chalk',
        'backdrop:bg-room/80 backdrop:backdrop-blur-sm',
        'open:animate-rise',
      )}
      style={{ '--modal-w': size === 'lg' ? '54rem' : '34rem' } as React.CSSProperties}
    >
      <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
        <div>
          <h2 className="type-display text-lg">{title}</h2>
          {hint ? <p className="mt-1 max-w-[46ch] text-xs text-slate">{hint}</p> : null}
        </div>
        <IconButton icon="close" label={t('action.close')} size="sm" onClick={onClose} />
      </header>

      <div className="max-h-[62dvh] overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-edge px-5 py-3">
          {footer}
        </footer>
      ) : null}
    </dialog>
  )
}
