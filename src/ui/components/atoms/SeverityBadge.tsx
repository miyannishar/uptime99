import { severityVar } from '../../utils/format'
import s from './SeverityBadge.module.css'

export interface SeverityBadgeProps {
  /** 1–5 from the incident definition. */
  severity: number
  /** Adds the family name, e.g. `SEV4 · infrastructure`. */
  family?: string
}

/**
 * `SEV4`. Each active incident contributes its severity to `incident_severity`,
 * which is the only direct hook an incident has into the metric layer - so this
 * number is worth showing prominently rather than burying in a tooltip.
 */
export function SeverityBadge({ severity, family }: SeverityBadgeProps) {
  return (
    <span
      className={s.root}
      style={{ ['--sev' as string]: severityVar(severity) }}
      title={`Severity ${severity} of 5${family ? ` · ${family}` : ''}`}
    >
      SEV{severity}
      {family && <span className={s.family}>{family}</span>}
    </span>
  )
}
