import type { WrongOutcome } from '../../types'
import s from './WrongOutcomeCard.module.css'

export interface WrongOutcomeCardProps {
  outcome: WrongOutcome
  /** 1-based attempt this outcome belongs to. */
  attempt: number
}

/**
 * What the wrong answer did.
 *
 * `shows` is authored with concrete numbers moving in the wrong direction ("p95
 * climbs to 340 ms as the cache misses compound"), and `why_wrong` explains the
 * reasoning error behind it. Both are shown: the consequence teaches that it
 * mattered, the explanation teaches why.
 *
 * The `when` value that selected this outcome is format-specific — `below`/`above`
 * for a dial, `wrong_order` for a sequence, and so on — and the engine has
 * already done that matching.
 */
export function WrongOutcomeCard({ outcome, attempt }: WrongOutcomeCardProps) {
  return (
    <div className={s.root}>
      <div className={s.head}>
        <span className={s.attempt}>attempt {attempt}</span>
        <span className={s.when}>{outcome.when.replace(/_/g, ' ')}</span>
      </div>
      <p className={s.shows}>{outcome.shows}</p>
      <p className={s.why}>{outcome.why_wrong}</p>
    </div>
  )
}
