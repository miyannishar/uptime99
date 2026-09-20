import type { WiringGiven } from '../../types'
import { cx } from '../../utils/format'
import s from './WiringGame.module.css'

export interface WiringGameProps {
  given: WiringGiven
  zone: string | null
  connectTo: readonly string[]
  onChange: (next: { zone: string | null; connectTo: string[] }) => void
  disabled?: boolean
  /** After three failures: `solution`. */
  revealed?: { zone: string; connectTo: readonly string[] }
}

/**
 * Format D - `wiring`.
 *
 * Dependency and failure-domain errors are a class of problem a form cannot
 * represent - "two replicas in one availability zone" looks fine as a number and
 * wrong as a picture. So the player places the new component into a zone and
 * chooses what it connects to, and the zones are drawn as the containers they
 * actually are.
 */
export function WiringGame({
  given,
  zone,
  connectTo,
  onChange,
  disabled,
  revealed,
}: WiringGameProps) {
  const activeZone = revealed?.zone ?? zone
  const activeLinks = revealed?.connectTo ?? connectTo
  const locked = disabled || Boolean(revealed)

  const toggleLink = (id: string) => {
    if (locked) return
    onChange({
      zone,
      connectTo: connectTo.includes(id)
        ? connectTo.filter((x) => x !== id)
        : [...connectTo, id],
    })
  }

  return (
    <div className={s.root}>
      <div className={s.zones}>
        {given.zones.map((z) => {
          const residents = given.nodes.filter((n) => n.zone === z)
          const placedHere = activeZone === z
          return (
            <button
              key={z}
              type="button"
              disabled={locked}
              className={cx(s.zone, placedHere && s.zoneActive)}
              onClick={() => !locked && onChange({ zone: z, connectTo: [...connectTo] })}
              aria-pressed={placedHere}
            >
              <span className={s.zoneName}>{z}</span>

              <span className={s.residents}>
                {residents.map((n) => (
                  <span key={n.id} className={s.resident}>
                    {n.label}
                  </span>
                ))}
                {residents.length === 0 && <span className={s.emptyZone}>empty</span>}

                {placedHere && (
                  <span className={cx(s.resident, s.placed)}>{given.place.label}</span>
                )}
              </span>

              {/* A zone is a failure domain: everything inside shares its fate. */}
              <span className={s.domain}>shared power · network · cooling</span>
            </button>
          )
        })}
      </div>

      <div className={s.connect}>
        <p className={s.connectLabel}>
          connect <b>{given.place.label}</b> to
        </p>
        <div className={s.targets}>
          {given.nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              disabled={locked}
              className={cx(s.target, activeLinks.includes(n.id) && s.targetOn)}
              onClick={() => toggleLink(n.id)}
              aria-pressed={activeLinks.includes(n.id)}
            >
              <span className={s.targetLabel}>{n.label}</span>
              {n.zone && <span className={s.targetZone}>{n.zone}</span>}
            </button>
          ))}
        </div>

        {given.edges && given.edges.length > 0 && (
          <p className={s.existing}>
            existing:{' '}
            {given.edges
              .map((e) => {
                const from = given.nodes.find((n) => n.id === e.from)?.label ?? e.from
                const to = given.nodes.find((n) => n.id === e.to)?.label ?? e.to
                return `${from} → ${to}`
              })
              .join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}
