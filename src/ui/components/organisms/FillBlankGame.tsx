import type { FillBlankGiven } from '../../types'
import { CodeBlock } from '../atoms'
import s from './FillBlankGame.module.css'

export interface FillBlankGameProps {
  given: FillBlankGiven
  blanks: Readonly<Record<string, string>>
  onChange: (blanks: Record<string, string>) => void
  /** From `levers.input_mode` — `free_text` removes the hint list. */
  inputMode?: 'pick_from_list' | 'free_text'
  disabled?: boolean
  /** After three failures: `solution.blanks`. */
  revealedBlanks?: Readonly<Record<string, string>>
}

/**
 * Format B — `fill_blank`.
 *
 * This is where the "writing real config" feeling lives: genuine YAML, a real
 * IAM policy, an actual command. The structure is present and correct and only
 * the decision points are blank, so the player is never tested on syntax recall
 * against a clock — only on the judgement the blank represents.
 *
 * `given.facts` carries the numbers the answer must be derived from. It is
 * rendered prominently, because an instance is only a judgement test if the
 * judgement is derivable from what the player is shown.
 */
export function FillBlankGame({
  given,
  blanks,
  onChange,
  inputMode = 'pick_from_list',
  disabled,
  revealedBlanks,
}: FillBlankGameProps) {
  const values = revealedBlanks ?? blanks
  const locked = disabled || Boolean(revealedBlanks)

  const set = (key: string, value: string) => onChange({ ...blanks, [key]: value })

  return (
    <div className={s.root}>
      {given.facts && (
        <p className={s.facts}>
          <span className={s.factsLabel}>given</span>
          {given.facts}
        </p>
      )}

      <CodeBlock
        code={given.template}
        language={given.language}
        lineNumbers
        renderBlank={(key) => {
          const options = given.options?.[key]
          const value = values[key] ?? ''

          if (inputMode === 'pick_from_list' && options?.length) {
            return (
              <select
                className={s.select}
                value={value}
                disabled={locked}
                aria-label={`Blank ${key}`}
                onChange={(e) => set(key, e.currentTarget.value)}
              >
                <option value="">·</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )
          }

          return (
            <input
              className={s.input}
              value={value}
              disabled={locked}
              size={Math.max(4, value.length + 1)}
              aria-label={`Blank ${key}`}
              onChange={(e) => set(key, e.currentTarget.value)}
            />
          )
        }}
      />
    </div>
  )
}
