import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx } from '~/lib/cx'

const INPUT_CLASS =
  'w-full rounded-control border border-edge bg-room/60 px-2.5 py-1.5 text-sm ' +
  'placeholder:text-slate/60 focus:border-preview/50 focus:outline-none focus-visible:outline-none'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  hint?: string
  /** Hide the label visually but keep it for screen readers. */
  quietLabel?: boolean
}

export function Field({ label, hint, quietLabel = false, ...rest }: FieldProps) {
  const id = useId()

  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cx('slug mb-1.5 block', quietLabel && 'sr-only')}>
        {label}
      </label>
      <input id={id} className={INPUT_CLASS} {...rest} />
      {hint ? <p className="mt-1 text-[11px] text-slate">{hint}</p> : null}
    </div>
  )
}

interface SwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}

export function Switch({ label, checked, onChange, hint }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-slate">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'mt-0.5 h-5 w-9 shrink-0 rounded-full border border-edge p-0.5 transition-colors',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-preview',
          checked ? 'bg-preview/80' : 'bg-rail',
        )}
      >
        <span
          className={cx(
            'block size-3.5 rounded-full bg-chalk transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </label>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  /** Rendered next to the label, e.g. "10 per row". */
  readout?: ReactNode
}

export function Slider({ label, value, min, max, step = 1, onChange, readout }: SliderProps) {
  const id = useId()

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="slug">
          {label}
        </label>
        <span className="type-mono text-[11px] text-slate">{readout ?? value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value))
        }}
        className="w-full accent-preview"
      />
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-control border border-edge p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value)
          }}
          className={cx(
            'rounded-[3px] px-2.5 py-1 text-xs transition-colors',
            option.value === value
              ? 'bg-chalk text-room font-semibold'
              : 'text-slate hover:text-chalk',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
