import { cx } from '../../utils/format'
import s from './DifficultyDots.module.css'

export interface DifficultyDotsProps {
  /** 1–5, from the invoking action's `difficulty`. */
  difficulty: number
  /** Prefix, e.g. the minigame name. */
  label?: string
}

/**
 * Difficulty comes from the ACTION, never from the minigame - a minigame has no
 * `difficulty_range` field anywhere. Together they form the difficulty-slot that
 * `checkSlotCoverage` requires an instance for.
 */
export function DifficultyDots({ difficulty, label }: DifficultyDotsProps) {
  return (
    <span className={s.root} title={`Difficulty ${difficulty} of 5`}>
      {label && <span className={s.label}>{label}</span>}
      <span className={s.dots} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cx(s.dot, i < difficulty && s.on, i < difficulty && i >= 3 && s.hard)} />
        ))}
      </span>
      <span className="visually-hidden">difficulty {difficulty} of 5</span>
    </span>
  )
}
