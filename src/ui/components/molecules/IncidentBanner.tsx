import type { ActiveIncident } from '../../types'
import { Panel, SeverityBadge } from '../atoms'
import { cx, formatElapsed, humanise } from '../../utils/format'
import s from './IncidentBanner.module.css'

export interface IncidentBannerProps {
  incident: ActiveIncident
  /** `economy.tick_seconds` - converts ticks into a readable clock. */
  tickSeconds?: number
  selected?: boolean
  onSelect?: (key: string) => void
}

/**
 * The header of one active incident.
 *
 * Three things here come straight out of the data and change how the player
 * should respond: `scope` (is this one node, a whole group, or a design gap with
 * no node at all), whether `resolved_by` is empty (survive-only - nothing you do
 * will end it), and how close `escalate_after_ticks` is to firing.
 */
export function IncidentBanner({
  incident,
  tickSeconds = 5,
  selected,
  onSelect,
}: IncidentBannerProps) {
  const { def, elapsedTicks, ticksRemaining, ticksToEscalation, affectedInstanceIds } = incident
  const surviveOnly = def.resolved_by.length === 0
  const escalating = ticksToEscalation !== null && ticksToEscalation <= 5

  return (
    <Panel
      tone="flush"
      className={cx(s.root, selected && s.selected)}
      onClick={onSelect ? () => onSelect(incident.key) : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className={s.top}>
        <SeverityBadge severity={def.severity} family={def.family} />
        <span className={s.name}>{def.name}</span>
        <span className={s.clock}>{formatElapsed(elapsedTicks * tickSeconds)}</span>
      </div>

      <div className={s.meta}>
        <span className={cx(s.scope, s[def.scope])} title={scopeHelp(def.scope)}>
          {def.scope}
        </span>

        {def.scope === 'group' && def.group_by && (
          <span className={s.chip}>by {humanise(def.group_by)}</span>
        )}

        {affectedInstanceIds.length > 0 && (
          <span className={s.chip}>
            {affectedInstanceIds.length} instance{affectedInstanceIds.length === 1 ? '' : 's'}
          </span>
        )}

        {surviveOnly && (
          <span className={s.survive} title="No action resolves this. It has to be ridden out.">
            survive only
          </span>
        )}

        {ticksRemaining !== null && (
          <span className={s.chip}>{ticksRemaining} ticks left</span>
        )}

        {ticksToEscalation !== null && def.escalates_to && (
          <span className={cx(s.escalate, escalating && s.escalateSoon)}>
            escalates to {def.escalates_to} in {ticksToEscalation}
          </span>
        )}
      </div>
    </Panel>
  )
}

function scopeHelp(scope: string): string {
  if (scope === 'instance') return 'Hit one node that matched the incident target.'
  if (scope === 'group') return 'Hit every matching node in the selected group at once.'
  return 'A gap in the architecture, not a component failure. No node is targeted.'
}
