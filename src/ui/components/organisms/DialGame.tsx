import type { DialGiven } from '../../types'
import { Slider } from '../atoms'
import s from './DialGame.module.css'

export interface DialGameProps {
  given: DialGiven
  value: number
  onChange: (value: number) => void
  /** From `levers.table_complete` - false hides some rows, forcing estimation. */
  tableComplete?: boolean
  disabled?: boolean
  /** After three failures: `solution.value`, plus the tolerance band. */
  revealedValue?: number
  /** From `levers.tolerance_pct`, used only to draw the band once revealed. */
  tolerancePct?: number
}

/**
 * Format C - `dial`.
 *
 * Thresholds, replica counts and instance sizes are continuous judgement calls
 * with cost consequences in BOTH directions, which is why every dial instance is
 * authored with both a `below` and an `above` wrong outcome. Under-provisioning
 * fails; over-provisioning works and wastes money, and that second lesson is a
 * real one.
 *
 * The target band is drawn only after the reveal. Showing it up front would turn
 * a judgement problem into tracing.
 */
export function DialGame({
  given,
  value,
  onChange,
  tableComplete = true,
  disabled,
  revealedValue,
  tolerancePct = 0,
}: DialGameProps) {
  const shown = revealedValue ?? value
  const band =
    revealedValue !== undefined
      ? ([
          revealedValue * (1 - tolerancePct / 100),
          revealedValue * (1 + tolerancePct / 100),
        ] as const)
      : undefined

  return (
    <div className={s.root}>
      <table className={s.table}>
        <tbody>
          {given.table.map((row, i) => {
            // `table_complete: false` withholds the tail of the table.
            const withheld = !tableComplete && i >= given.table.length - 1
            return (
              <tr key={row.label} className={withheld ? s.withheld : undefined}>
                <th scope="row" className={s.label}>
                  {row.label}
                </th>
                <td className={s.value}>{withheld ? 'not measured' : row.value}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className={s.dial}>
        <Slider
          min={given.range.min}
          max={given.range.max}
          value={shown}
          onChange={onChange}
          unit={given.unit}
          disabled={disabled || revealedValue !== undefined}
          targetBand={band}
          ariaLabel={`Set ${given.unit}`}
        />
      </div>
    </div>
  )
}
