import { useEffect } from 'react'
import type { ReactNode } from 'react'
import s from './MinigameOverlay.module.css'

export interface MinigameOverlayProps {
  open: boolean
  children: ReactNode
  /** Escape / backdrop click. Omit to make the overlay non-dismissable. */
  onDismiss?: () => void
}

/**
 * Modal layer for a minigame or the debrief.
 *
 * Modal on purpose: a minigame is a decision the player has committed to, and
 * leaving the board interactive underneath would invite them to fiddle with the
 * architecture mid-diagnosis. The backdrop is only dismissable when the caller
 * says so, because a minigame in progress has already charged its time cost.
 */
export function MinigameOverlay({ open, children, onDismiss }: MinigameOverlayProps) {
  useEffect(() => {
    if (!open || !onDismiss) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  if (!open) return null

  return (
    <div
      className={s.backdrop}
      onClick={onDismiss ? (e) => e.target === e.currentTarget && onDismiss() : undefined}
      role="presentation"
    >
      {children}
    </div>
  )
}
