import { clamp, formatDuration } from '../../utils/format'
import s from './CooldownRing.module.css'

export interface CooldownRingProps {
  /** Seconds left, from `inst.action_cooldowns[actionId]`. */
  remainingS: number
  /** The action's full `cooldown_s`, for the ring proportion. */
  totalS: number
  size?: number
}

/**
 * Countdown ring for an action on cooldown. The remaining seconds are also
 * printed next to it by ActionRow — the ring is never the only encoding.
 */
export function CooldownRing({ remainingS, totalS, size = 14 }: CooldownRingProps) {
  const r = (size - 2) / 2
  const circumference = 2 * Math.PI * r
  const done = totalS > 0 ? clamp(1 - remainingS / totalS, 0, 1) : 1

  return (
    <svg
      className={s.root}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`on cooldown, ${formatDuration(remainingS)} remaining`}
    >
      <circle className={s.track} cx={size / 2} cy={size / 2} r={r} />
      <circle
        className={s.progress}
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - done)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
