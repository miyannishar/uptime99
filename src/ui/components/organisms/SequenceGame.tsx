import { useState } from 'react'
import type { SequenceGiven } from '../../types'
import { cx } from '../../utils/format'
import s from './SequenceGame.module.css'

export interface SequenceGameProps {
  given: SequenceGiven
  /** Indices into `given.steps`, in the player's chosen order. */
  order: readonly number[]
  onChange: (order: number[]) => void
  disabled?: boolean
  /** After three failures: `solution.order`. */
  revealedOrder?: readonly number[]
}

/**
 * Format A — `ordered_sequence`.
 *
 * Order is operationally consequential: a DNS cutover, a restore and a
 * certificate chain each have exactly one right sequence, and getting it wrong
 * produces a real failure mode rather than a style complaint.
 *
 * Dragging is offered but never required — every row also has ↑/↓ buttons and
 * full keyboard operation, because a drag-only puzzle is unplayable for some
 * people and this one is load-bearing for the lesson.
 */
export function SequenceGame({
  given,
  order,
  onChange,
  disabled,
  revealedOrder,
}: SequenceGameProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (disabled || to < 0 || to >= order.length) return
    const next = [...order]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  const list = revealedOrder ?? order

  return (
    <ol className={s.root}>
      {list.map((stepIndex, position) => {
        const correct = revealedOrder ? true : undefined
        return (
          <li
            key={stepIndex}
            className={cx(s.row, dragIndex === position && s.dragging, correct && s.correct)}
            draggable={!disabled && !revealedOrder}
            onDragStart={() => setDragIndex(position)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== position) {
                move(dragIndex, position)
                setDragIndex(position)
              }
            }}
          >
            <span className={s.ordinal}>{position + 1}</span>
            <span className={s.grip} aria-hidden="true">
              ⠿
            </span>
            <span className={s.text}>{given.steps[stepIndex]}</span>

            {!disabled && !revealedOrder && (
              <span className={s.nudge}>
                <button
                  type="button"
                  className={s.arrow}
                  onClick={() => move(position, position - 1)}
                  disabled={position === 0}
                  aria-label={`Move step ${position + 1} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={s.arrow}
                  onClick={() => move(position, position + 1)}
                  disabled={position === order.length - 1}
                  aria-label={`Move step ${position + 1} later`}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
