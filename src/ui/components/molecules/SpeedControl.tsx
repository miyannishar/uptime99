import { cx } from '../../utils/format'
import s from './SpeedControl.module.css'

/** 0 = paused. 1–3 are tick multipliers. */
export type Speed = 0 | 1 | 2 | 3

export interface SpeedControlProps {
  speed: Speed
  onChange: (speed: Speed) => void
  /** `economy.tick_seconds`, shown so the player knows what a tick costs. */
  tickSeconds?: number
  /** Current tick number. */
  tick?: number
}

const STEPS: { value: Speed; glyph: string; title: string }[] = [
  { value: 0, glyph: '❙❙', title: 'Pause' },
  { value: 1, glyph: '▶', title: 'Normal' },
  { value: 2, glyph: '▶▶', title: 'Fast' },
  { value: 3, glyph: '▶▶▶', title: 'Fastest' },
]

export function SpeedControl({ speed, onChange, tickSeconds = 5, tick }: SpeedControlProps) {
  return (
    <div className={s.root}>
      {tick !== undefined && (
        <span className={s.tick} title={`${tickSeconds}s per tick`}>
          tick <b>{tick}</b>
        </span>
      )}
      <div className={s.steps} role="radiogroup" aria-label="Game speed">
        {STEPS.map((step) => (
          <button
            key={step.value}
            type="button"
            role="radio"
            aria-checked={speed === step.value}
            aria-label={step.title}
            title={step.title}
            className={cx(s.step, speed === step.value && s.on, step.value === 0 && s.pause)}
            onClick={() => onChange(step.value)}
          >
            {step.glyph}
          </button>
        ))}
      </div>
    </div>
  )
}
