import type { LedgerLine } from '../../types'
import { cx, formatMoney, humanise } from '../../utils/format'
import s from './LedgerRow.module.css'

export interface LedgerRowProps {
  line: LedgerLine
}

/**
 * One priced event.
 *
 * Incidents never contain a currency amount - they emit a `kind` and a `basis`
 * expression, and the cost engine prices it from `economy`. By the time a line
 * reaches this component the pricing is done, so the row's job is to attribute
 * the charge: which kind of event, from which incident or action.
 */
export function LedgerRow({ line }: LedgerRowProps) {
  const charge = line.amount < 0

  return (
    <div className={s.root}>
      <span className={cx(s.kind, s[line.kind])}>{humanise(line.kind)}</span>
      <span className={s.label}>{line.label}</span>
      <span className={s.tick}>t{line.tick}</span>
      <span className={cx(s.amount, charge ? s.charge : s.credit)}>
        {formatMoney(line.amount, { sign: true })}
      </span>
    </div>
  )
}
