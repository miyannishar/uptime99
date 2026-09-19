import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './CodeBlock.module.css'

export interface CodeBlockProps {
  /** Raw text. For fill_blank this is the instance's `given.template`. */
  code: string
  /** From `given.language`, shown as a corner label only. */
  language?: string
  lineNumbers?: boolean
  /** 1-based line numbers to highlight, e.g. the culprit line in a log. */
  highlight?: readonly number[]
  /**
   * Called for each `{{key}}` placeholder found in `code`. This is how the
   * fill_blank format renders its inputs inline without a second component
   * needing to re-parse the template.
   */
  renderBlank?: (key: string) => ReactNode
  /** Selectable lines, used by the evidence format. */
  onLineClick?: (lineIndex: number) => void
  selectedLines?: readonly number[]
  maxHeight?: number
}

const BLANK = /\{\{([^}]+)\}\}/g

function renderLine(line: string, renderBlank?: (key: string) => ReactNode): ReactNode {
  if (!renderBlank || !line.includes('{{')) return line
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(BLANK)) {
    const at = m.index ?? 0
    if (at > last) out.push(line.slice(last, at))
    out.push(<span key={`${at}-${m[1]}`}>{renderBlank(m[1])}</span>)
    last = at + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

/**
 * Monospace block for YAML manifests, IAM policies, log tails and query plans.
 * Deliberately not syntax-highlighted: the instance data carries no token
 * information, and inventing highlighting would mean guessing at a grammar.
 */
export function CodeBlock({
  code,
  language,
  lineNumbers,
  highlight,
  renderBlank,
  onLineClick,
  selectedLines,
  maxHeight,
}: CodeBlockProps) {
  const lines = code.split('\n')

  return (
    <div className={s.root} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      {language && <span className={s.lang}>{language}</span>}
      <pre className={s.pre}>
        <code>
          {lines.map((line, i) => {
            const n = i + 1
            const isHit = highlight?.includes(n)
            const isSel = selectedLines?.includes(i)
            const clickable = Boolean(onLineClick)
            return (
              <span
                key={i}
                className={cx(s.line, isHit && s.hit, isSel && s.sel, clickable && s.clickable)}
                onClick={clickable ? () => onLineClick?.(i) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onLineClick?.(i)
                        }
                      }
                    : undefined
                }
              >
                {lineNumbers && <span className={s.num}>{n}</span>}
                <span className={s.text}>{renderLine(line, renderBlank) || ' '}</span>
              </span>
            )
          })}
        </code>
      </pre>
    </div>
  )
}
