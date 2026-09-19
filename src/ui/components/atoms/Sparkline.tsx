import type { Status } from '../../types'
import { cx } from '../../utils/format'
import s from './Sparkline.module.css'

export interface SparklineProps {
  /** Oldest to newest. Fewer than two points renders nothing. */
  series: readonly number[]
  status?: Status
  width?: number
  height?: number
  /** Shades the band the metric is healthy in, from `def.healthy_range`. */
  healthyRange?: readonly [number, number]
  label: string
}

/** Metric history for the header tiles. Purely supplementary to the number. */
export function Sparkline({
  series,
  status = 'ok',
  width = 54,
  height = 16,
  healthyRange,
  label,
}: SparklineProps) {
  if (series.length < 2) return <span className={s.empty} style={{ width, height }} />

  const lo = Math.min(...series, ...(healthyRange ?? []))
  const hi = Math.max(...series, ...(healthyRange ?? []))
  const span = hi - lo || 1
  const x = (i: number) => (i / (series.length - 1)) * width
  const y = (v: number) => height - ((v - lo) / span) * height

  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const band = healthyRange
    ? { top: y(Math.max(healthyRange[0], healthyRange[1])), bottom: y(Math.min(healthyRange[0], healthyRange[1])) }
    : null

  return (
    <svg
      className={s.root}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {band && (
        <rect className={s.band} x={0} y={band.top} width={width} height={Math.max(1, band.bottom - band.top)} />
      )}
      <polyline className={cx(s.line, s[status])} points={points} />
    </svg>
  )
}
