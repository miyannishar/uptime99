import { useEffect, useRef, useState } from 'react'
import type { StakeholderDef, StakeholderResponse } from '@engine/stakeholders'
import s from './StakeholderCard.module.css'

export interface StakeholderCardProps {
  message: StakeholderDef
  /** Called once with the chosen response, or with `null` when the message expires unanswered. */
  onResolve: (response: StakeholderResponse | null) => void
  /** Called when the card has finished showing the reply and should unmount. */
  onDone: () => void
}

const PERSONA_ICON: Record<string, string> = {
  cto: '◆', support_lead: '☎', investor: '$', customer: '◎', finance: '¤',
}

/**
 * A timed message from someone who is not an engineer. Real seconds, not game
 * ticks: the player reads it while the incident keeps running. The reply stays on
 * screen briefly so the consequence of the choice is legible.
 */
export function StakeholderCard({ message, onResolve, onDone }: StakeholderCardProps) {
  const [left, setLeft] = useState(message.expires_s)
  const [reply, setReply] = useState<string | null>(null)
  const [effect, setEffect] = useState<string | null>(null)
  const settledRef = useRef(false)
  const startRef = useRef(performance.now())

  const settle = (r: StakeholderResponse | null, text: string) => {
    if (settledRef.current) return
    settledRef.current = true
    onResolve(r)
    setReply(text)
    // The header's reputation updates on the next tick; show the effect here now.
    const applied = r ?? [...message.responses].sort((a, b) => a.reputation_delta - b.reputation_delta)[0]
    const parts = [
      applied.reputation_delta !== 0 && `${applied.reputation_delta > 0 ? '+' : '−'}${Math.abs(applied.reputation_delta)} reputation`,
      applied.budget_delta !== 0 && `−$${Math.abs(applied.budget_delta)}`,
    ].filter(Boolean)
    setEffect(parts.length ? parts.join(' · ') : 'no change')
    window.setTimeout(onDone, 3000)
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      const remaining = Math.max(0, message.expires_s - (performance.now() - startRef.current) / 1000)
      setLeft(remaining)
      if (remaining <= 0) {
        window.clearInterval(id)
        settle(null, `No reply. ${message.name.split(' ')[0]} noticed.`)
      }
    }, 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])

  return (
    <aside className={s.card} role="dialog" aria-label={`Message from ${message.name}`}>
      <header className={s.head}>
        <span className={s.icon} aria-hidden="true">{PERSONA_ICON[message.persona] ?? '•'}</span>
        <span className={s.name}>{message.name}</span>
        {!reply && <span className={s.timer}>{Math.ceil(left)}s</span>}
      </header>
      <p className={s.text}>{message.text}</p>
      {reply ? (
        <>
          <p className={s.reply}>{reply}</p>
          {effect && <p className={s.effect}>{effect}</p>}
        </>
      ) : (
        <>
          <div className={s.responses}>
            {message.responses.map((r) => (
              <button key={r.label} type="button" className={s.response} onClick={() => settle(r, r.reply)}>
                {r.label}
                {r.budget_delta !== 0 && <span className={s.cost}>{r.budget_delta < 0 ? `−$${-r.budget_delta}` : `+$${r.budget_delta}`}</span>}
              </button>
            ))}
          </div>
          <div className={s.bar}><div className={s.fill} style={{ width: `${(left / message.expires_s) * 100}%` }} /></div>
        </>
      )}
    </aside>
  )
}
