import { cx } from '../../utils/format'
import s from './Led.module.css'

export type LedState = 'ok' | 'bad' | 'warn' | 'off'

export interface LedProps {
  state: LedState
  /** Stagger for banks of LEDs so they do not blink in lockstep. */
  delayMs?: number
}

/**
 * A single status light on the 3D rack.
 *
 * Decorative by design: it restates a fact the inspector already prints as
 * text. It disappears entirely in FLAT mode, so it must never be the only place
 * a fact appears - see the note at the top of styles/tokens.css.
 */
export function Led({ state, delayMs = 0 }: LedProps) {
  return (
    <span
      className={cx(s.root, s[state])}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    />
  )
}
