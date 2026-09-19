import { useMemo } from 'react'
import type { Distractor, EvidenceGiven } from '../../types'
import { CodeBlock } from '../atoms'
import { cx } from '../../utils/format'
import s from './EvidenceGame.module.css'

export interface EvidenceGameProps {
  given: EvidenceGiven
  /** The correct answer text, from `solution.choice`. */
  solutionChoice: string
  distractors?: readonly Distractor[]
  choice: string | null
  onChange: (choice: string) => void
  /** Stable shuffle seed — pass the instance id. */
  seed: string
  disabled?: boolean
  /** After three failures, marks the right one and shows each `why_wrong`. */
  revealed?: boolean
}

const KIND_LABEL: Record<EvidenceGiven['kind'], string> = {
  log: 'log tail',
  explain: 'query plan',
  deploy_history: 'deploy history',
}

/** Deterministic order so the correct choice is not always first. */
function shuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = (h ^ seed.charCodeAt(i)) * 16777619
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 16807) % 2147483647
    const j = Math.abs(h) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Format E — `evidence`.
 *
 * Slow queries, bad deploys and crash logs require reading evidence and ruling
 * out distractors: interpretation, not configuration. The distractors are the
 * whole difficulty — `distractor_plausibility: high` means they are topically
 * related errors that need real domain knowledge to reject, and each carries its
 * own `why_wrong` so a wrong pick teaches why it was tempting.
 *
 * Note what the log shows: the line explaining a crash is rarely the last line.
 * Restart noise and downstream connection errors come after the cause, and the
 * output is authored so reading top-down beats reading bottom-up.
 */
export function EvidenceGame({
  given,
  solutionChoice,
  distractors = [],
  choice,
  onChange,
  seed,
  disabled,
  revealed,
}: EvidenceGameProps) {
  const options = useMemo(
    () =>
      shuffle(
        [
          { choice: solutionChoice, why_wrong: null as string | null },
          ...distractors.map((d) => ({ choice: d.choice, why_wrong: d.why_wrong })),
        ],
        seed,
      ),
    [solutionChoice, distractors, seed],
  )

  return (
    <div className={s.root}>
      <div className={s.evidence}>
        <div className={s.evidenceHead}>
          <span className={s.kind}>{KIND_LABEL[given.kind]}</span>
          {given.context && <span className={s.context}>{given.context}</span>}
        </div>
        <CodeBlock code={given.output} lineNumbers maxHeight={260} />
      </div>

      <fieldset className={s.choices}>
        <legend className={s.legend}>What is the root cause?</legend>
        {options.map((opt) => {
          const selected = choice === opt.choice
          const isCorrect = opt.why_wrong === null
          return (
            <label
              key={opt.choice}
              className={cx(
                s.choice,
                selected && s.selected,
                revealed && isCorrect && s.right,
                revealed && selected && !isCorrect && s.wrong,
              )}
            >
              <input
                type="radio"
                name={`evidence-${seed}`}
                className={s.radio}
                checked={selected}
                disabled={disabled || revealed}
                onChange={() => onChange(opt.choice)}
              />
              <span className={s.choiceText}>{opt.choice}</span>
              {revealed && opt.why_wrong && <span className={s.why}>{opt.why_wrong}</span>}
              {revealed && isCorrect && <span className={s.correctMark}>correct</span>}
            </label>
          )
        })}
      </fieldset>
    </div>
  )
}
