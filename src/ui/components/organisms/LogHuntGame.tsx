import { useState, useEffect, useRef } from 'react'
import type { LogHuntGiven, LogHuntSolution } from '../../types'
import { cx } from '../../utils/format'
import s from './LogHuntGame.module.css'

export interface LogHuntGameProps {
  given: LogHuntGiven
  solution: LogHuntSolution
  /** Currently selected 1-based line number, or null for no selection. */
  line: number | null
  onChange: (line: number | null) => void
  searchEnabled?: boolean
  disabled?: boolean
  /** After three failures, scroll to and highlight the answer line. */
  revealed?: boolean
}

type FilterLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO'

const LEVEL_CSS: Record<string, string> = {
  FATAL: s.levelFATAL,
  ERROR: s.levelERROR,
  WARN: s.levelWARN,
  INFO: s.levelINFO,
  DEBUG: s.levelDEBUG,
}

function levelClass(level: string): string {
  return LEVEL_CSS[level.toUpperCase()] ?? s.levelDefault
}

/**
 * Format G - `log_hunt`.
 *
 * A scrollable monospace log panel. The player clicks the single line that is
 * the root cause; downstream symptom lines are decoys. A level-filter row and
 * optional search box help narrow the view. Clicking a line selects it; clicking
 * again deselects.
 */
export function LogHuntGame({
  given,
  solution,
  line,
  onChange,
  searchEnabled = true,
  disabled,
  revealed,
}: LogHuntGameProps) {
  const [filter, setFilter] = useState<FilterLevel>('ALL')
  const [query, setQuery] = useState('')
  const revealRef = useRef<HTMLDivElement>(null)

  // Scroll to the revealed answer line when reveal becomes true
  useEffect(() => {
    if (revealed && revealRef.current) {
      revealRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [revealed])

  // Map filtered lines back to their original 1-based index
  const filteredWithIdx = given.lines
    .map((l, i) => ({ l, orig: i + 1 }))
    .filter(({ l }) => {
      if (revealed) return true
      const levelMatch =
        filter === 'ALL' ||
        (filter === 'ERROR' && (l.level.toUpperCase() === 'ERROR' || l.level.toUpperCase() === 'FATAL')) ||
        l.level.toUpperCase() === filter
      const queryMatch =
        query === '' || l.text.toLowerCase().includes(query.toLowerCase()) || l.ts.includes(query)
      return levelMatch && queryMatch
    })

  function handleLineClick(origIdx: number) {
    if (disabled) return
    onChange(line === origIdx ? null : origIdx)
  }

  return (
    <div className={s.root}>
      <div className={s.header}>{given.source}</div>

      <div className={s.controls}>
        <div className={s.chips}>
          {(['ALL', 'ERROR', 'WARN', 'INFO'] as FilterLevel[]).map((lvl) => (
            <button
              key={lvl}
              className={cx(s.chip, filter === lvl && s.chipActive)}
              onClick={() => setFilter(lvl)}
              disabled={disabled || revealed}
              type="button"
            >
              {lvl}
            </button>
          ))}
        </div>
        {searchEnabled && (
          <input
            className={s.search}
            type="text"
            placeholder="filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled || revealed}
            spellCheck={false}
            aria-label="Search log lines"
          />
        )}
      </div>

      <div className={s.log} role="listbox" aria-label="Log lines">
        {filteredWithIdx.length === 0 && (
          <div className={s.emptyState}>no lines match the current filter</div>
        )}
        {filteredWithIdx.map(({ l, orig }) => {
          const isSelected = line === orig && !revealed
          const isRevealed = revealed && orig === solution.line
          return (
            <div
              key={orig}
              ref={isRevealed ? revealRef : undefined}
              className={cx(
                s.line,
                isSelected && s.lineSelected,
                isRevealed && s.lineRevealed,
                (disabled || revealed) && s.lineDisabled,
              )}
              onClick={() => handleLineClick(orig)}
              role="option"
              aria-selected={isSelected}
              aria-label={`Line ${orig}: [${l.level}] ${l.text}`}
            >
              <span className={s.lineNum}>{orig}</span>
              <span className={s.ts}>{l.ts}</span>
              <span className={levelClass(l.level)}>[{l.level}]</span>
              <span className={s.text}>{l.text}</span>
            </div>
          )
        })}
      </div>

      {!revealed && line === null && (
        <p className={s.hint}>Click the line that is the root cause of the incident.</p>
      )}
    </div>
  )
}
