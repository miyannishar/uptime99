import type { ActiveIncident } from '../../types'
import { SectionLabel } from '../atoms'
import { IncidentBanner, SignalRow } from '../molecules'
import s from './IncidentFeed.module.css'

export interface IncidentFeedProps {
  incidents: readonly ActiveIncident[]
  selectedKey?: string | null
  onSelect?: (key: string) => void
  tickSeconds?: number
  /** Sum of `severity` across all active incidents - feeds the reputation formula. */
  incidentSeverity?: number
  /** Called when the player clicks a resolving action button. */
  onPlayAction?: (instanceId: string, actionId: string, incidentKey: string) => void
  /** How this incident's page was handled: seconds to ACK, 'unacked', or undefined (not paged). */
  ackOf?: (key: string) => number | 'unacked' | undefined
  /** Why an action cannot be played on an instance right now, or null. */
  blockedReason?: (instanceId: string, actionId: string) => string | null
}

/**
 * The live incident list.
 *
 * `incident_severity` is shown here because it is not stored anywhere: the
 * reputation formula computes it as the sum of `severity` across active
 * incidents each tick. Surfacing it makes the reputation drop legible - a player
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
  onPlayAction,
  blockedReason,
  ackOf,
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
              {(() => {
                const ack = ackOf?.(incident.key)
                if (ack === undefined) return null
                return (
                  <span className={ack === 'unacked' ? s.unacked : s.acked}>
                    {ack === 'unacked' ? 'page unacknowledged' : `acked in ${ack}s`}
                  </span>
                )
              })()}

              {open && (
                <div className={s.detail}>
                  {/* Actions first — the player needs them immediately */}
                  {incident.resolvingActions.length > 0 ? (
                    <div className={s.resolvers}>
                      <span className={s.resolversLabel}>resolved by</span>
                      <div className={s.actionButtons}>
                        {incident.resolvingActions.map((a) => {
                          const instanceId = incident.affectedInstanceIds[0]
                          const reason = !onPlayAction || !instanceId
                            ? 'No affected instance'
                            : blockedReason?.(instanceId, a.id) ?? null
                          return (
                            <button
                              key={a.id}
                              type="button"
                              className={s.actionBtn}
                              disabled={reason !== null}
                              onClick={reason === null ? () => onPlayAction!(instanceId, a.id, incident.key) : undefined}
                              title={reason ?? `Play ${a.name} minigame`}
                            >
                              {a.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className={s.survive}>
                      Nothing resolves this. It runs its course
                      {incident.ticksRemaining !== null && ` - ${incident.ticksRemaining} ticks left`}.
                    </p>
                  )}

                  {/* Signals below actions */}
                  <div className={s.signals}>
                    {incident.signals.map((signal) => (
                      <SignalRow key={signal.level} signal={signal} />
                    ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
