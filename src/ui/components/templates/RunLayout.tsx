import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export interface RunLayoutProps {
  header: ReactNode
  /** IncidentFeed — left, because it is what forces the player to act. */
  feed: ReactNode
  /** BoardCanvas. */
  board: ReactNode
  /** NodeInspector for the selected node. */
  inspector: ReactNode
  /** TaskDock: provisioning, cooldowns, recent charges. */
  dock?: ReactNode
  overlay?: ReactNode
}

/**
 * The live phase. The catalog is gone — during a run the player changes the
 * system through ACTIONS, not by dragging in new components, and leaving the
 * catalog open would suggest otherwise.
 */
export function RunLayout({ header, feed, board, inspector, dock, overlay }: RunLayoutProps) {
  return (
    <AppShell
      header={header}
      left={feed}
      main={board}
      right={inspector}
      dock={dock}
      overlay={overlay}
    />
  )
}
