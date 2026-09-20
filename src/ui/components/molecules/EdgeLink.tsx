import type { Status } from '../../types'
import { cx } from '../../utils/format'
import s from './EdgeLink.module.css'

export interface Point {
  x: number
  y: number
}

export interface EdgeLinkProps {
  from: Point
  to: Point
  /** Drives the colour. Derived from the DOWNSTREAM node's condition. */
  status?: Status
  /** Traffic is not flowing - the downstream node is unreachable. */
  severed?: boolean
  /** Dims links not connected to the selected node. */
  dimmed?: boolean
  /** Screen-reader description, e.g. "load balancer to app-us-01". */
  label?: string
}

/**
 * A connector between two nodes on the board, rendered inside BoardCanvas's SVG
 * layer. Traffic is a dashed overlay whose offset animates, so the flow reads at
 * a glance without one DOM element per particle. In FLAT the dashes hold still.
 */
export function EdgeLink({ from, to, status = 'ok', severed, dimmed, label }: EdgeLinkProps) {
  // Horizontal cubic: control points pushed out along x so the curve leaves and
  // enters each card square-on, which keeps the layer columns legible.
  const dx = Math.max(18, Math.abs(to.x - from.x) * 0.5)
  const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`

  return (
    <g className={cx(s.root, dimmed && s.dimmed)} aria-hidden={label ? undefined : 'true'}>
      {label && <title>{label}</title>}
      <path className={s.base} d={d} />
      {!severed && <path className={cx(s.flow, s[status])} d={d} />}
      {severed && <path className={s.severed} d={d} />}
    </g>
  )
}
