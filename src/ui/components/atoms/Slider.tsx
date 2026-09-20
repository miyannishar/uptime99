import { clamp, cx, ratio } from '../../utils/format'
import s from './Slider.module.css'

export interface SliderProps {
  /** From the dial instance's `given.range.min`. */
  min: number
  /** From `given.range.max`. */
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  /** From `given.unit`, e.g. "workers", "replicas", "ms". */
  unit?: string
  ariaLabel: string
  disabled?: boolean
  /**
   * Shades an acceptable band. Only ever passed AFTER the answer is revealed -
   * showing the target band up front would turn the judgement into tracing.
   */
  targetBand?: readonly [number, number]
}

/**
 * Native range input under the hood, so keyboard and screen-reader support come
 * for free. This is the primitive behind the `dial` format.
 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  unit,
  ariaLabel,
  disabled,
  targetBand,
}: SliderProps) {
  const pct = ratio(value, min, max) * 100
  const band = targetBand
    ? {
        left: ratio(clamp(targetBand[0], min, max), min, max) * 100,
        right: 100 - ratio(clamp(targetBand[1], min, max), min, max) * 100,
      }
    : null

  return (
    <div className={cx(s.root, disabled && s.disabled)}>
      <div className={s.readout}>
        <span className={s.value}>{value.toLocaleString('en-US')}</span>
        {unit && <span className={s.unit}>{unit}</span>}
      </div>

      <div className={s.track}>
        {band && <span className={s.band} style={{ left: `${band.left}%`, right: `${band.right}%` }} />}
        <span className={s.fill} style={{ width: `${pct}%` }} />
        <input
          className={s.input}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={unit ? `${value} ${unit}` : String(value)}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
      </div>

      <div className={s.bounds}>
        <span>{min.toLocaleString('en-US')}</span>
        <span>{max.toLocaleString('en-US')}</span>
      </div>
    </div>
  )
}
