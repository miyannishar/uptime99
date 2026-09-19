import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './AppShell.module.css'

export interface AppShellProps {
  /** MetricsHeader. Always visible, in both phases. */
  header: ReactNode
  /** CatalogDrawer in the design phase; omitted during a run. */
  aside?: ReactNode
  /** BoardCanvas. */
  main: ReactNode
  /** NodeInspector or DesignPhasePanel. */
  panel?: ReactNode
  /** IncidentFeed, under the panel so incidents and actions read together. */
  feed?: ReactNode
  /** MinigameOverlay / DebriefPanel. */
  overlay?: ReactNode
}

/**
 * The frame every phase shares.
 *
 * The board takes the space and the panel is fixed-width, because the board is
 * what the player reads and the panel is what they act in. The incident feed sits
 * UNDER the panel rather than across the bottom: an incident and the actions that
 * resolve it belong in the same column, so a player can read a signal and then
 * act without their eye crossing the screen.
 */
export function AppShell({ header, aside, main, panel, feed, overlay }: AppShellProps) {
  return (
    <div className={cx(s.root, aside && s.withAside, panel && s.withPanel)}>
      <div className={s.header}>{header}</div>

      {aside && <div className={s.aside}>{aside}</div>}

      <main className={s.main}>{main}</main>

      {panel && (
        <div className={s.side}>
          <div className={s.panel}>{panel}</div>
          {feed && <div className={s.feed}>{feed}</div>}
        </div>
      )}

      {overlay}
    </div>
  )
}
