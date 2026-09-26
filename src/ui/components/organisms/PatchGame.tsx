import { useRef, useEffect } from 'react'
import type { ChangeEvent } from 'react'
import type { PatchGiven, PatchSolution } from '../../types'
import { cx } from '../../utils/format'
import s from './PatchGame.module.css'

export interface PatchGameProps {
  given: PatchGiven
  solution: PatchSolution
  /** Current file content the player has edited (starts equal to given.content). */
  content: string
  onChange: (content: string) => void
  /** When true, the gutter marks the line that needs changing. */
  targetHighlighted?: boolean
  disabled?: boolean
  /** After three failures, show the resolved target line. */
  revealed?: boolean
}

/**
 * Format H - `patch`.
 *
 * An in-browser text editor showing a full config file. Only the target line
 * may change; every other line must stay byte-for-byte identical to the
 * original. A "reset file" button restores `given.content`. When `revealed`,
 * the target line is shown with the required `must_contain` values so the
 * player understands what the correct edit looks like.
 */
export function PatchGame({
  given,
  solution,
  content,
  onChange,
  targetHighlighted,
  disabled,
  revealed,
}: PatchGameProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  // Sync gutter scroll with textarea scroll
  useEffect(() => {
    const ta = textareaRef.current
    const gt = gutterRef.current
    if (!ta || !gt) return
    const handler = () => {
      gt.scrollTop = ta.scrollTop
    }
    ta.addEventListener('scroll', handler, { passive: true })
    return () => ta.removeEventListener('scroll', handler)
  }, [])

  const lines = content.split('\n')
  const origLines = given.content.split('\n')
  const targetIdx = solution.line - 1

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
  }

  function handleReset() {
    onChange(given.content)
  }

  // When revealed, replace the target line with must_contain values joined
  const displayContent = revealed
    ? origLines
        .map((l, i) =>
          i === targetIdx
            ? l.replace(/\S.*$/, solution.must_contain.join(' '))
            : l,
        )
        .join('\n')
    : content

  return (
    <div className={s.root}>
      <span className={s.tab}>{given.filename}</span>

      <div className={s.editor}>
        {/* Line-number gutter */}
        <div className={s.gutter} ref={gutterRef} aria-hidden="true">
          {origLines.map((_, i) => (
            <span
              key={i}
              className={cx(
                s.lineNum,
                targetHighlighted && i === targetIdx && s.lineNumTarget,
              )}
            >
              {i + 1}
            </span>
          ))}
        </div>

        {/* Editable file body */}
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={revealed ? displayContent : content}
          onChange={handleChange}
          disabled={disabled || revealed}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          aria-label={`Edit ${given.filename}`}
          rows={Math.max(lines.length, origLines.length) + 1}
        />
      </div>

      <div className={s.controls}>
        <button
          type="button"
          className={s.resetBtn}
          onClick={handleReset}
          disabled={disabled || revealed}
          title="Restore the original file contents"
        >
          reset file
        </button>
      </div>
    </div>
  )
}
