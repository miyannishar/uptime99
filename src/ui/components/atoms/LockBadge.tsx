import s from './LockBadge.module.css'

export interface LockBadgeProps {
  /** What would unlock this, already in English via `describeConstraint`. */
  requirement: string
  /** Shown before the requirement, e.g. "needs". */
  verb?: string
}

/**
 * Marks content the player has not earned visibility into. Used for signal
 * levels 1–3, whose `requires` constraint names the observability node and tier
 * that would reveal them. Showing the locked row rather than hiding it is the
 * whole point: the player must be able to see what their missing investment in
 * monitoring is costing them.
 */
export function LockBadge({ requirement, verb = 'needs' }: LockBadgeProps) {
  return (
    <span className={s.root}>
      <span className={s.icon} aria-hidden="true">
        &#9679;&#8211;
      </span>
      {verb} {requirement}
    </span>
  )
}
