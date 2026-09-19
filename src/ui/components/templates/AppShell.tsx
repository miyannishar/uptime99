import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './AppShell.module.css'

export interface AppShellProps {
  /** MetricsHeader. Always visible, in both phases. */
  header: ReactNode
  /**
   * Left column — what is coming at the player. IncidentFeed during a run,
   * CatalogDrawer during design. Both answer "what do I have to deal with",
   * which is why they share the column rather than competing for it.
   */
  left?: ReactNode
  /** BoardCanvas. The centre, because it is what the player reads. */
  main: ReactNode
  /** Right column — what the player can do. NodeInspector or DesignPhasePanel. */
  right?: ReactNode
  /** Full-width bottom dock: work in flight, cooldowns, recent charges. */
  dock?: ReactNode
  /** MinigameOverlay / DebriefPanel. */
  overlay?: ReactNode
}

/**
 * The frame every phase shares.
 *
 * Three columns, in the order the player's attention moves: the incident arrives
 * on the LEFT, they read the system in the MIDDLE, and they act on the RIGHT.
 * That ordering matters more than it looks — reading state before acting is the
 * habit the game exists to build, and a layout that puts the action list first
 * would teach the opposite.
 *
 * The board takes all the slack; both side columns are fixed-width so a node card
 * never reflows as the inspector's content changes length.
 */
export function AppShell({ header, left, main, right, dock, overlay }: AppShellProps) {
  return (
    <div className={cx(s.root, left && s.withLeft, right && s.withRight, dock && s.withDock)}>
      <div className={s.header}>{header}</div>

      {left && <div className={s.left}>{left}</div>}

      <main className={s.main}>{main}</main>

      {right && <div className={s.right}>{right}</div>}

      {dock && <div className={s.dock}>{dock}</div>}

      {overlay}
    </div>
  )
}
