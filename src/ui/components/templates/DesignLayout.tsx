import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export interface DesignLayoutProps {
  header: ReactNode
  /** CatalogDrawer - takes the left column the incident feed uses during a run. */
  catalog: ReactNode
  /** BoardCanvas. */
  board: ReactNode
  /** DesignPhasePanel. */
  summary: ReactNode
  /** TaskDock: anything already provisioning, plus committed spend. */
  dock?: ReactNode
  overlay?: ReactNode
}

/**
 * The untimed phase: catalog left, board centre, projection right.
 *
 * No incident feed, because nothing is firing yet - the left column is what the
 * player can add rather than what is happening to them, and the right column is
 * consequences they are choosing rather than reacting to.
 */
export function DesignLayout({
  header,
  catalog,
  board,
  summary,
  dock,
  overlay,
}: DesignLayoutProps) {
  return (
    <AppShell
      header={header}
      left={catalog}
      main={board}
      right={summary}
      dock={dock}
      overlay={overlay}
    />
  )
}
