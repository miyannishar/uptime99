import type { MetricReading } from '../../types'
import { MetricValue, Sparkline } from '../atoms'
import { cx, formatMetric } from '../../utils/format'
import s from './MetricTile.module.css'

export interface MetricTileProps {
  reading: MetricReading
  /** Compact single-line form for the header strip. */
  inline?: boolean
  /** Reveals `def.formula` - opt-in, because it is implementation detail. */
  showFormula?: boolean
  onClick?: () => void
}

/**
 * One metric. The healthy range is drawn as a band behind the sparkline so the
 * player can see not just the number but whether it is where it should be -
 * `healthy_range` is authored in metrics.json precisely so the UI can show it.
 */
export function MetricTile({ reading, inline, showFormula, onClick }: MetricTileProps) {
  const { def, value, previous, series, status } = reading
  const [lo, hi] = def.healthy_range

  if (inline) {
    return (
      <span className={s.inline} title={`${def.name} - healthy ${formatMetric(lo, def.unit)}–${formatMetric(hi, def.unit)}`}>
        <span className={s.inlineLabel}>{def.name}</span>
        <MetricValue value={value} def={def} previous={previous} status={status} />
      </span>
    )
  }

  return (
    <div
      className={cx(s.root, onClick && s.clickable)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={s.top}>
        <span className={s.label}>{def.name}</span>
        <span className={cx(s.kind, def.kind === 'business' && s.business)}>{def.kind}</span>
      </div>

      <MetricValue value={value} def={def} previous={previous} status={status} size="md" />

      {series && series.length > 1 && (
        <Sparkline
          series={series}
          status={status}
          healthyRange={def.healthy_range}
          label={`${def.name} history`}
        />
      )}

      <div className={s.range}>
        healthy {formatMetric(lo, def.unit)} – {formatMetric(hi, def.unit)}
      </div>

      {showFormula && <code className={s.formula}>{def.formula}</code>}
    </div>
  )
}
