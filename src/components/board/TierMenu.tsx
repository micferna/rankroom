import { useEffect, useRef, useState } from 'react'
import { Icon } from '~/components/ui/Icon'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'

interface TierMenuProps {
  label: string
  ink: string
  color: string
  onRecolor: (color: string) => void
  canMoveUp: boolean
  canMoveDown: boolean
  canRemove: boolean
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

/**
 * Tier controls in one button instead of a column of three.
 *
 * The column was costing ~28px of height on every row — invisible on a desktop,
 * but on a phone it was the single biggest waste on screen, and hover-revealed
 * controls do not work on touch at all.
 */
export function TierMenu({
  label,
  ink,
  color,
  onRecolor,
  canMoveUp,
  canMoveDown,
  canRemove,
  onMove,
  onRemove,
}: TierMenuProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const item = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs disabled:opacity-40'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('tier.menu', { label })}
        onClick={() => {
          setOpen(!open)
        }}
        className="grid size-4 place-items-center rounded-[3px] opacity-60 transition-opacity hover:opacity-100"
        style={{ color: ink }}
      >
        <Icon name="settings" size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-rise absolute top-5 right-0 z-20 w-40 overflow-hidden rounded-control border border-edge bg-desk py-1 text-chalk shadow-xl shadow-room/60"
        >
          <label className={cx(item, 'cursor-pointer hover:bg-rail')}>
            <input
              type="color"
              value={color}
              onChange={(event) => {
                onRecolor(event.target.value)
              }}
              className="size-3.5 cursor-pointer appearance-none border-0 bg-transparent p-0"
            />
            {t('tier.colour')}
          </label>

          <button
            type="button"
            role="menuitem"
            className={cx(item, 'hover:bg-rail')}
            disabled={!canMoveUp}
            onClick={() => {
              onMove(-1)
              setOpen(false)
            }}
          >
            <Icon name="chevronUp" size={13} />
            {t('tier.moveUp', { label })}
          </button>
          <button
            type="button"
            role="menuitem"
            className={cx(item, 'hover:bg-rail')}
            disabled={!canMoveDown}
            onClick={() => {
              onMove(1)
              setOpen(false)
            }}
          >
            <Icon name="chevronDown" size={13} />
            {t('tier.moveDown', { label })}
          </button>
          <button
            type="button"
            role="menuitem"
            className={cx(item, 'text-program hover:bg-program/10')}
            disabled={!canRemove}
            onClick={() => {
              onRemove()
              setOpen(false)
            }}
          >
            <Icon name="trash" size={13} />
            {t('tier.remove', { label })}
          </button>
        </div>
      ) : null}
    </div>
  )
}
