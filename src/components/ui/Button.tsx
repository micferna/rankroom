import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '~/lib/cx'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'quiet' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  // Preview green is the "go" bus of a vision mixer; it marks the affirmative action.
  primary:
    'bg-preview text-room hover:brightness-110 active:brightness-95 disabled:bg-preview/40 font-semibold',
  quiet: 'bg-rail text-chalk hover:bg-rail/70 border border-edge',
  ghost: 'text-slate hover:text-chalk hover:bg-rail/60',
  danger: 'bg-program/12 text-program border border-program/35 hover:bg-program/22',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: IconName
  children?: ReactNode
}

export function Button({
  variant = 'quiet',
  size = 'md',
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control',
        'transition-[background-color,color,filter,opacity] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Required: the icon alone is not an accessible name. */
  label: string
  variant?: Variant
  size?: Size
  active?: boolean
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-control',
        'transition-[background-color,color] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-9',
        active ? 'bg-preview/15 text-preview' : VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  )
}
