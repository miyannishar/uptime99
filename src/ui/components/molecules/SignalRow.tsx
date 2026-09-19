import type { ResolvedSignal } from '../../types'
import { LockBadge } from '../atoms'
import { cx, SIGNAL_LEVEL_LABEL } from '../../utils/format'
import s from './SignalRow.module.css'

export interface SignalRowProps {
  signal: ResolvedSignal
}

/**
 * One line of what the player can see about an incident.
 *
 * Two rules from the incident design are load-bearing here:
 *
 * 1. **Level 0 is always unlocked.** Its `requires` is null by authoring rule —
 *    it is what an on-call engineer sees on their phone before opening a
 *    dashboard, and it must never name a layer, component or root cause.
 *
 * 2. **Locked levels still occupy a row.** Hiding them would hide the cost of
 *    not investing in observability. The player sees that a diagnosis exists and
 *    exactly which node and tier would buy it.
 */
export function SignalRow({ signal }: SignalRowProps) {
  const { level, text, unlocked, requirementLabel } = signal

  return (
    <div className={cx(s.root, !unlocked && s.locked)}>
      <span className={cx(s.level, s[`l${level}`])} title={SIGNAL_LEVEL_LABEL[level]}>
        L{level}
      </span>

      {unlocked ? (
        <p className={s.text}>{text}</p>
      ) : (
        <p className={s.hidden}>
          <span className={s.redacted} aria-hidden="true">
            {'▓'.repeat(28)}
          </span>
          <LockBadge requirement={requirementLabel ?? 'more observability'} />
          <span className="visually-hidden">
            Signal level {level} is not available: {requirementLabel ?? 'more observability required'}
          </span>
        </p>
      )}
    </div>
  )
}
