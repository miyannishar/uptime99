import type { ReactNode } from 'react'
import { AppShell } from './AppShell'

export interface DesignLayoutProps {
  header: ReactNode
  /** CatalogDrawer. */
  catalog: ReactNode
  /** BoardCanvas. */
  board: ReactNode
  /** DesignPhasePanel. */
  summary: ReactNode
  overlay?: ReactNode
}

/**
 * The untimed phase: catalog on the left, board in the middle, projection on the
 * right. No incident feed, because nothing is firing yet — the right column is
 * entirely about consequences the player is choosing rather than reacting to.
 */
export function DesignLayout({ header, catalog, board, summary, overlay }: DesignLayoutProps) {
  return (
    <AppShell header={header} aside={catalog} main={board} panel={summary} overlay={overlay} />
  )
}
