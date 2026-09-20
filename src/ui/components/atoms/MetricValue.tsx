import type { MetricDef, Status } from '../../types'
import { cx, formatMetric, metricStatus, metricTrend } from '../../utils/format'
import s from './MetricValue.module.css'

export interface MetricValueProps {
  value: number
  /** Pass the MetricDef and status/formatting derive themselves from the data. */
  def: MetricDef
  /** Previous tick - renders the trend arrow, oriented by `def.direction`. */
  previous?: number
  /** Overrides the derived status. Rarely needed. */
  status?: Status
  size?: 'sm' | 'md' | 'lg'
}

/**
 * One metric number. The colour comes from `def.healthy_range` and the arrow's
 * good/bad sense from `def.direction`, so a falling `p95_latency_ms` reads green
 * while a falling `uptime_pct` reads red without either being special-cased.
 */
export function MetricValue({ value, def, previous, status, size = 'sm' }: MetricValueProps) {
  const tone = status ?? metricStatus(value, def)
  const trend = metricTrend(value, previous, def)

  return (
    <span className={cx(s.root, s[size])}>
      <span className={cx(s.value, s[tone])}>{formatMetric(value, def.unit)}</span>
      {trend.arrow !== '·' && (
        <span
          className={cx(s.trend, trend.good ? s.good : s.poor)}
          title={`${trend.delta > 0 ? '+' : ''}${formatMetric(trend.delta, def.unit)} since last tick`}
        >
          {trend.arrow}
        </span>
      )}
    </span>
  )
}
