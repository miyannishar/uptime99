import s from './TeachesCallout.module.css'

export interface TeachesCalloutProps {
  /** The instance's `teaches` — a transferable principle, not the answer. */
  teaches: string
  /** Shown after success; muted while the puzzle is still open. */
  earned?: boolean
}

/**
 * The takeaway line.
 *
 * `teaches` is authored as a principle the player can apply elsewhere ("CPU
 * requests are specified in 25m steps, rounded up from measured steady-state"),
 * never as a restatement of the answer. It is the single most reusable thing the
 * minigame layer produces, which is why it gets its own component and shows up
 * again in the debrief.
 */
export function TeachesCallout({ teaches, earned }: TeachesCalloutProps) {
  return (
    <div className={s.root} data-earned={earned}>
      <span className={s.label}>takeaway</span>
      <p className={s.text}>{teaches}</p>
    </div>
  )
}
