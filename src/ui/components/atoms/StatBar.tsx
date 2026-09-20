import type { Status } from '../../types'
import { clamp, cx } from '../../utils/format'
import s from './StatBar.module.css'

export interface StatBarProps {
  /** 0–100. Values above 100 are rendered as overflow rather than clipped. */
  value: number
  status?: Status
  /** Draws a marker at this percentage, e.g. the saturation knee. */
  marker?: number
  /** Accessible description. Required - the bar is never the only encoding. */
  label: string
  size?: 'sm' | 'md'
}

/**
 * The thin horizontal bar used for health, utilisation and hit ratio.
 * Above 100% a second segment renders in the overflow colour, because a node at
 * 140% utilisation is a different fact from one pinned at 100%.
 */
export function StatBar({ value, status = 'ok', marker, label, size = 'sm' }: StatBarProps) {
  const main = clamp(value, 0, 100)
  const over = value > 100 ? clamp(value - 100, 0, 100) : 0

  return (
    <div
      className={cx(s.root, size === 'md' && s.md)}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span className={cx(s.fill, s[status])} style={{ width: `${main}%` }} />
      {over > 0 && <span className={s.over} style={{ width: `${over}%` }} />}
      {marker !== undefined && <span className={s.marker} style={{ left: `${clamp(marker, 0, 100)}%` }} />}
    </div>
  )
}
