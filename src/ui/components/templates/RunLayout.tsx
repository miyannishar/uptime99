import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export interface RunLayoutProps {
  header: ReactNode
  /** BoardCanvas. */
  board: ReactNode
  /** NodeInspector for the selected node. */
  inspector: ReactNode
  /** IncidentFeed. */
  feed: ReactNode
  overlay?: ReactNode
}

/**
 * The live phase. The catalog is gone — during a run the player changes the
 * system through ACTIONS, not by dragging in new components, and leaving the
 * catalog open would suggest otherwise.
 */
export function RunLayout({ header, board, inspector, feed, overlay }: RunLayoutProps) {
  return (
    <AppShell header={header} main={board} panel={inspector} feed={feed} overlay={overlay} />
  )
}
