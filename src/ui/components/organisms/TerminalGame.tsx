import type { ChangeEvent, KeyboardEvent } from 'react'
import type { TerminalGiven, TerminalSolution } from '../../types'
import s from './TerminalGame.module.css'

export interface TerminalGameProps {
  given: TerminalGiven
  solution: TerminalSolution
  /** Current typed suffix text. */
  text: string
  onChange: (text: string) => void
  /** When true a greyed placeholder hints at the shape of the missing argument. */
  showPlaceholder?: boolean
  disabled?: boolean
  /** After three failures, show the accepted answer. */
  revealed?: boolean
  /** Optional: pressing Enter submits the minigame. */
  onSubmit?: () => void
}

/**
 * Format F - `terminal`.
 *
 * A dark monospace panel showing prior shell output followed by a live prompt.
 * The player types the rest of the command — just the part after `prefix` — and
 * submits. The prefix is shown inline so the player knows exactly where their
 * input begins. Comparison is case-sensitive (shell commands are).
 */
export function TerminalGame({
  given,
  solution,
  text,
  onChange,
  showPlaceholder,
  disabled,
  revealed,
  onSubmit,
}: TerminalGameProps) {
  const placeholder = showPlaceholder && given.placeholder ? given.placeholder : undefined

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className={s.root}>
      <div className={s.panel} aria-label="shell history">
        {given.history.map((line, i) => (
          <div key={i} className={s.historyLine}>{line}</div>
        ))}
        <div className={s.promptRow}>
          <span className={s.ps1}>$ </span>
          <span className={s.prefix}>{given.prefix}</span>
          {revealed ? (
            <span className={s.revealedValue}>{solution.accepts[0]}</span>
          ) : (
            <input
              type="text"
              className={s.input}
              value={text}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              aria-label={`Complete command: ${given.prefix}`}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
            />
          )}
        </div>
      </div>
    </div>
  )
}
