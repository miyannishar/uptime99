import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardNode, ResolvedAction } from '../../types'
import { DifficultyDots } from '../atoms'
import { cx, formatDuration, formatMoney } from '../../utils/format'
import s from './CommandPalette.module.css'

export interface PaletteEntry {
  /** The action, already resolved against a specific node. */
  action: ResolvedAction
  node: BoardNode
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Every action playable on every node right now. */
  entries: readonly PaletteEntry[]
  onRun: (instanceId: string, actionId: string) => void
}

/**
 * ⌘K. The speed path for a player who has learned the vocabulary.
 *
 * Deliberately secondary to the inspector: the inspector teaches "read the
 * node's state, then choose", and the palette is what that habit compresses into
 * once it is internalised. It matches on action id, action name and node name, so
 * `add_repl` and `postgres` both find the same thing.
 */
export function CommandPalette({ open, onClose, entries, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q
      ? entries.filter(
          (e) =>
            e.action.def.id.includes(q) ||
            e.action.def.name.toLowerCase().includes(q) ||
            e.node.def.name.toLowerCase().includes(q) ||
            e.node.inst.instance_id.includes(q),
        )
      : entries
    // Playable first, then the ones that resolve something live.
    return [...pool]
      .sort((a, b) => {
        const ready = Number(b.action.availability === 'ready') - Number(a.action.availability === 'ready')
        if (ready) return ready
        return Number(b.action.resolvesActiveIncident) - Number(a.action.resolvesActiveIncident)
      })
      .slice(0, 40)
  }, [entries, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  if (!open) return null

  const commit = (index: number) => {
    const entry = results[index]
    if (!entry || entry.action.availability !== 'ready') return
    onRun(entry.node.inst.instance_id, entry.action.def.id)
    onClose()
  }

  return (
    <div className={s.backdrop} onClick={onClose} role="presentation">
      <div
        className={s.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className={s.input}
          value={query}
          placeholder="action or node…"
          aria-label="Search actions"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(cursor)
            }
          }}
        />

        <ul className={s.results}>
          {results.length === 0 && <li className={s.none}>nothing matches</li>}
          {results.map((entry, i) => {
            const { action, node } = entry
            const disabled = action.availability !== 'ready'
            return (
              <li
                key={`${node.inst.instance_id}:${action.def.id}`}
                className={cx(s.row, i === cursor && s.cursor, disabled && s.disabled)}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(i)}
              >
                <span className={s.action}>{action.def.id}</span>
                <span className={s.on}>on</span>
                <span className={s.node}>{node.inst.instance_id}</span>
                {action.resolvesActiveIncident && <span className={s.fixes}>resolves</span>}
                <span className={s.spacer} />
                <DifficultyDots
                  difficulty={action.def.difficulty}
                  label={(action.def.minigame_pool?.length ?? 0) > 0
                    ? `${action.def.minigame_pool!.length + 1} puzzle types`
                    : action.minigame.name}
                />
                <span className={s.cost}>
                  {formatDuration(action.def.time_cost_s)}
                  {' · '}
                  {action.effectiveMoneyCost === 0 ? 'free' : formatMoney(action.effectiveMoneyCost)}
                </span>
                {disabled && <span className={s.blocked}>{action.availability}</span>}
              </li>
            )
          })}
        </ul>

        <footer className={s.foot}>
          <span>↑↓ move</span>
          <span>⏎ run</span>
          <span>esc close</span>
        </footer>
      </div>
    </div>
  )
}
