import { cx } from '../../utils/format'
import s from './Toggle.module.css'

export interface ToggleOption<T extends string> {
  value: T
  label: string
  title?: string
}

export interface ToggleProps<T extends string> {
  options: readonly ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Required — the control has no visible caption of its own. */
  ariaLabel: string
  size?: 'xs' | 'sm'
}

/**
 * Segmented control. Used for the DEPTH/FLAT/AUTO preference and for the
 * boolean and enum levers a minigame format declares.
 */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'xs',
}: ToggleProps<T>) {
  return (
    <div className={cx(s.root, size === 'sm' && s.sm)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          title={opt.title}
          className={cx(s.seg, opt.value === value && s.on)}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
