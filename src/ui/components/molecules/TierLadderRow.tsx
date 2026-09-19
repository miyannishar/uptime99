import type { CapacityUnit, TierLadderEntry } from '../../types'
import { Button } from '../atoms'
import { cx, formatCapacity, formatMoney } from '../../utils/format'
import s from './TierLadderRow.module.css'

export interface TierLadderRowProps {
  entry: TierLadderEntry
  capacityUnit: CapacityUnit
  onUpgrade?: (tier: number) => void
}

/**
 * One rung of a node's upgrade path.
 *
 * The cost delta is the answer to "what does the next nine cost?" — and it is
 * DERIVED from `cost_month` on the tiers, never authored anywhere. Writing that
 * number into a data file would guarantee drift the next time a tier changes.
 */
export function TierLadderRow({ entry, capacityUnit, onUpgrade }: TierLadderRowProps) {
  const { tier, isCurrent, costDelta, locked } = entry
  const { stats } = tier

  return (
    <div className={cx(s.root, isCurrent && s.current, locked && s.locked)}>
      <span className={s.left}>
        <span className={s.tier}>T{tier.tier}</span>
        <span className={s.name}>{tier.name}</span>
      </span>

      <span className={s.right}>
        <span className={s.avail}>{stats.availability_pct.toFixed(2)}%</span>
        <span className={s.cap}>{formatCapacity(stats.capacity, capacityUnit)}</span>
        <span className={s.cost}>{formatMoney(stats.cost_month)}/mo</span>
        {!isCurrent && costDelta !== 0 && (
          <span className={cx(s.delta, costDelta > 0 ? s.up : s.down)}>
            {formatMoney(costDelta, { sign: true })}
          </span>
        )}
        {isCurrent && <span className={s.now}>current</span>}
        {!isCurrent && !locked && onUpgrade && (
          <Button variant="quiet" onClick={() => onUpgrade(tier.tier)}>
            set
          </Button>
        )}
      </span>
    </div>
  )
}
