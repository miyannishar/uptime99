import type { PortFill } from '../../types'
import { cx, humanise } from '../../utils/format'
import s from './PortSlot.module.css'

export interface PortSlotProps {
  fill: PortFill
  /** Resolves an instance_id to a display name. */
  nameOf?: (instanceId: string) => string
  onClick?: (port: string) => void
}

/**
 * One `requires` port on a node — what it needs wired in for the board to run.
 *
 * `min: 0` ports are genuinely optional (app_cluster can run with no cache);
 * `min: 1` ports are not (a worker_pool with no queue has nothing to consume).
 * The distinction is in the data and has to survive into the UI, because an
 * unsatisfied required port is a board that will not start.
 */
export function PortSlot({ fill, nameOf = (id) => id, onClick }: PortSlotProps) {
  const { port, filled, satisfied } = fill
  const required = port.min > 0
  const slots = Math.max(port.min, Math.min(port.max, Math.max(filled.length, port.min || 1)))

  return (
    <div
      className={cx(s.root, !satisfied && required && s.unmet, onClick && s.clickable)}
      onClick={onClick ? () => onClick(port.port) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={s.head}>
        <span className={s.name}>{humanise(port.port)}</span>
        <span className={cx(s.count, !satisfied && required && s.countBad)}>
          {filled.length}/{port.min === port.max ? port.max : `${port.min}–${port.max}`}
          {!required && <span className={s.optional}>optional</span>}
        </span>
      </div>

      <div className={s.pips} aria-hidden="true">
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={cx(s.pip, i < filled.length && s.pipOn)} />
        ))}
      </div>

      <div className={s.accepts}>
        accepts {port.accepts.map(humanise).join(' · ')}
      </div>

      {filled.length > 0 && (
        <div className={s.wired}>{filled.map(nameOf).join(', ')}</div>
      )}
    </div>
  )
}
