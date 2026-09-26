import { useEffect, useRef, useState } from 'react'
import s from './PagerOverlay.module.css'

export interface PagerPage {
  /** Incident record key. */
  readonly key: string
  readonly name: string
  readonly severity: number
  /** Level-0 signal text only — a page never carries diagnostics (CLAUDE.md §13). */
  readonly text: string
}

export interface PagerOverlayProps {
  page: PagerPage
  /** Seconds before the page times out unacknowledged. */
  ackWindowS?: number
  onAck: (key: string, seconds: number) => void
  onTimeout: (key: string) => void
  /** Plays the page tone; called on show and again on timeout. */
  onTone?: () => void
}

/**
 * Full-screen page for a high-severity arrival. The game clock keeps running:
 * the pressure is that the incident is already costing reputation while the
 * player reads this. ACK (button or Enter) dismisses it and records the time.
 */
export function PagerOverlay({ page, ackWindowS = 15, onAck, onTimeout, onTone }: PagerOverlayProps) {
  const [left, setLeft] = useState(ackWindowS)
  const [expiring, setExpiring] = useState(false)
  const startRef = useRef(performance.now())
  const doneRef = useRef(false)
  const ackRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    startRef.current = performance.now()
    doneRef.current = false
    setLeft(ackWindowS)
    setExpiring(false)
    onTone?.()
    ackRef.current?.focus()
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000
      const remaining = Math.max(0, ackWindowS - elapsed)
      setLeft(remaining)
      if (remaining <= 0 && !doneRef.current) {
        doneRef.current = true
        window.clearInterval(id)
        onTone?.()
        setExpiring(true)
        window.setTimeout(() => onTimeout(page.key), 1000)
      }
    }, 100)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.key])

  const ack = () => {
    if (doneRef.current) return
    doneRef.current = true
    onAck(page.key, Math.round((performance.now() - startRef.current) / 1000))
  }

  return (
    <div className={s.backdrop} role="alertdialog" aria-modal="true" aria-label={`Page: ${page.name}`}>
      <div className={`${s.pager} ${expiring ? s.expiring : ''}`}>
        <div className={s.top}>
          <span className={s.sev}>PAGE · SEV{page.severity}</span>
          <span className={s.timer}>{Math.ceil(left)}s to acknowledge</span>
        </div>
        <h2 className={s.name}>{page.name}</h2>
        <p className={s.text}>{page.text}</p>
        <div className={s.bar}><div className={s.fill} style={{ width: `${(left / ackWindowS) * 100}%` }} /></div>
        <button
          ref={ackRef}
          type="button"
          className={s.ack}
          onClick={ack}
          onKeyDown={(e) => { if (e.key === 'Enter') ack() }}
        >
          ACK
        </button>
        <p className={s.note}>The clock is still running.</p>
      </div>
    </div>
  )
}
