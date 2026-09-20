import { StatBar } from '../atoms'
import { cx, formatMoney, ratio } from '../../utils/format'
import s from './BudgetMeter.module.css'

export interface BudgetMeterProps {
  /** Credits in hand. Starts at `economy.starting_budget`. */
  budget: number
  /** `economy.starting_budget`, for the proportion. */
  startingBudget: number
  /** `profit_month` - positive means the budget is growing. */
  profitMonth?: number
  /** Pending commitment in the design phase. */
  pending?: number
  compact?: boolean
}

/**
 * Money in hand, plus whether it is going up or down.
 *
 * `profit_month` is `users * arpu - cost_month`, so a negative number here means
 * the architecture costs more than it earns - the single most important thing a
 * player can misread, and the reason it sits next to the budget rather than
 * buried among the other metrics.
 */
export function BudgetMeter({
  budget,
  startingBudget,
  profitMonth,
  pending = 0,
  compact,
}: BudgetMeterProps) {
  const remaining = budget - pending
  const insufficient = remaining < 0
  const bleeding = profitMonth !== undefined && profitMonth < 0

  if (compact) {
    return (
      <span className={s.inline}>
        <span className={cx(s.amount, insufficient && s.bad)}>{formatMoney(budget)}</span>
        {profitMonth !== undefined && (
          <span className={cx(s.profit, bleeding ? s.bad : s.good)}>
            {formatMoney(profitMonth, { sign: true })}/mo
          </span>
        )}
      </span>
    )
  }

  return (
    <div className={s.root}>
      <div className={s.top}>
        <span className={s.label}>Budget</span>
        <span className={cx(s.amount, insufficient && s.bad)}>{formatMoney(remaining)}</span>
      </div>

      <StatBar
        value={ratio(Math.max(remaining, 0), 0, startingBudget) * 100}
        status={insufficient ? 'bad' : remaining < startingBudget * 0.2 ? 'warn' : 'ok'}
        label={`${formatMoney(remaining)} of ${formatMoney(startingBudget)} remaining`}
      />

      <div className={s.foot}>
        {pending > 0 && <span className={s.pending}>{formatMoney(pending)} committed</span>}
        {profitMonth !== undefined && (
          <span className={cx(s.profit, bleeding ? s.bad : s.good)}>
            {bleeding ? 'losing ' : 'earning '}
            {formatMoney(Math.abs(profitMonth))}/mo
          </span>
        )}
      </div>
    </div>
  )
}
