import type { ReactNode } from 'react'
import { SectionLabel } from '../atoms'
import s from './RevealPanel.module.css'

export interface RevealPanelProps {
  /** The instance's `reveal` - explains the mechanism, not the answer. */
  reveal: string
  /**
   * The solution, rendered by the format component (an ordered list, a filled
   * template, a dial value). Shown above the explanation because by this point
   * the player has earned it.
   */
  solution?: ReactNode
}

/**
 * Shown after the third failed attempt.
 *
 * The player still executes the action and still pays the time cost - the reveal
 * is not a skip, it is the guarantee that nobody gets permanently stuck without
 * learning the lesson. `reveal` is authored to explain why the answer is the
 * answer, because at this point the player already knows what it is.
 */
export function RevealPanel({ reveal, solution }: RevealPanelProps) {
  return (
    <div className={s.root}>
      {solution && (
        <>
          <SectionLabel>Solution</SectionLabel>
          <div className={s.solution}>{solution}</div>
        </>
      )}
      <SectionLabel rule={Boolean(solution)}>Why</SectionLabel>
      <p className={s.reveal}>{reveal}</p>
    </div>
  )
}
