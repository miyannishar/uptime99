import type { ActiveIncident } from '../../types'
import { SectionLabel } from '../atoms'
import { IncidentBanner, SignalRow } from '../molecules'
import s from './IncidentFeed.module.css'

export interface IncidentFeedProps {
  incidents: readonly ActiveIncident[]
  selectedKey?: string | null
  onSelect?: (key: string) => void
  tickSeconds?: number
  /** Sum of `severity` across all active incidents — feeds the reputation formula. */
  incidentSeverity?: number
}

/**
 * The live incident list.
 *
 * `incident_severity` is shown here because it is not stored anywhere: the
 * reputation formula computes it as the sum of `severity` across active
 * incidents each tick. Surfacing it makes the reputation drop legible — a player
 * watching reputation fall with no explanation learns nothing.
 *
 * The selected incident expands to show all four signal levels, locked ones
 * included. See SignalRow for why the locked rows are not hidden.
 */
export function IncidentFeed({
  incidents,
  selectedKey,
  onSelect,
  tickSeconds = 5,
  incidentSeverity,
}: IncidentFeedProps) {
  const severity = incidentSeverity ?? incidents.reduce((n, i) => n + i.def.severity, 0)

  return (
    <section className={s.root} aria-label="Active incidents">
      <div className={s.head}>
        <SectionLabel
          aside={
            incidents.length > 0 ? (
              <span className={s.severity} title="Sum of severity across active incidents. Enters the reputation formula.">
                incident_severity {severity}
              </span>
            ) : undefined
          }
        >
          Active incidents {incidents.length > 0 && `· ${incidents.length}`}
        </SectionLabel>
      </div>

      {incidents.length === 0 && (
        <p className={s.quiet}>All quiet. Nothing is firing.</p>
      )}

      <ul className={s.list}>
        {incidents.map((incident) => {
          const open = selectedKey === incident.key
          return (
            <li key={incident.key} className={s.item}>
              <IncidentBanner
                incident={incident}
                tickSeconds={tickSeconds}
                selected={open}
                onSelect={onSelect}
              />

              {open && (
                <div className={s.detail}>
                  <div className={s.signals}>
                    {incident.signals.map((signal) => (
                      <SignalRow key={signal.level} signal={signal} />
                    ))}
                  </div>

                  {incident.resolvingActions.length > 0 ? (
                    <p className={s.resolvers}>
                      <span className={s.resolversLabel}>resolved by</span>
                      {incident.resolvingActions.map((a) => a.name).join(' · ')}
                    </p>
                  ) : (
                    <p className={s.survive}>
                      Nothing resolves this. It runs its course
                      {incident.ticksRemaining !== null && ` — ${incident.ticksRemaining} ticks left`}.
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
