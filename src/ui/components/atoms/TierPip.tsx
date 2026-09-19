import { cx } from '../../utils/format'
import s from './TierPip.module.css'

export interface TierPipProps {
  /** Current tier, 1-based. */
  tier: number
  /** How many tiers this node has — 3 or 4. */
  max: number
  /** Tier display name, e.g. "Anycast, two providers". */
  name?: string
  /** Hides the pips and shows only `T3`. */
  compact?: boolean
}

/**
 * `T3` plus one pip per tier, filled to the current one. The pips make the
 * remaining upgrade headroom visible at a glance, which is the thing a player
 * needs when deciding where the next budget goes.
 */
export function TierPip({ tier, max, name, compact }: TierPipProps) {
  return (
    <span className={s.root} title={name ? `Tier ${tier} — ${name}` : `Tier ${tier} of ${max}`}>
      <span className={s.num}>T{tier}</span>
      {!compact && (
        <span className={s.pips} aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <span key={i} className={cx(s.pip, i < tier && s.on, i === max - 1 && tier === max && s.top)} />
          ))}
        </span>
      )}
      <span className="visually-hidden">
        Tier {tier} of {max}
        {name ? `, ${name}` : ''}
      </span>
    </span>
  )
}
