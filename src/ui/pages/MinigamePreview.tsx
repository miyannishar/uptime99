import { useState } from 'react'
import type { MinigameAnswer, MinigameSession, WrongOutcome } from '../types'
import { MinigameShell } from '../components/organisms'
import { Toggle } from '../components/atoms'
import { sampleSessions } from '../fixtures/sampleRun'
import s from './MinigamePreview.module.css'

/**
 * All five interaction formats, side by side, each loaded with a real instance
 * from data/minigames/instances/.
 *
 * Submitting cycles the attempt counter so the wrong-outcome history and the
 * post-third-failure reveal are both reachable - that loop is the whole teaching
 * mechanism and it is the part that most needs to be looked at rather than
 * described.
 */
export function MinigamePreview() {
  const [which, setWhich] = useState(0)
  const [attempt, setAttempt] = useState(1)
  const [history, setHistory] = useState<WrongOutcome[]>([])
  const [answers, setAnswers] = useState<Record<string, MinigameAnswer>>({})

  const base = sampleSessions[which]
  if (!base) return <p className={s.empty}>No instances resolved from data/.</p>

  const session: MinigameSession = {
    ...base,
    attempt,
    revealed: attempt > 3,
    answer: answers[base.instance.id] ?? base.answer,
  }

  const reset = (next: number) => {
    setWhich(next)
    setAttempt(1)
    setHistory([])
  }

  return (
    <div className={s.root}>
      <div className={s.bar}>
        <Toggle
          size="sm"
          ariaLabel="Interaction format"
          value={String(which)}
          onChange={(v) => reset(Number(v))}
          options={sampleSessions.map((sess, i) => ({
            value: String(i),
            label: sess.format.name,
            title: sess.format.description,
          }))}
        />
        <span className={s.meta}>
          {session.minigame.id} · difficulty {session.action.difficulty} · instance{' '}
          <code>{session.instance.id}</code>
        </span>
        <button type="button" className={s.reset} onClick={() => reset(which)}>
          reset attempts
        </button>
      </div>

      <div className={s.stage}>
        <MinigameShell
          session={session}
          history={history}
          onAnswerChange={(answer) =>
            setAnswers((prev) => ({ ...prev, [base.instance.id]: answer }))
          }
          onSubmit={() => {
            if (attempt > 3) return
            const outcome =
              base.instance.wrong_outcomes[
                Math.min(attempt - 1, base.instance.wrong_outcomes.length - 1)
              ]
            if (outcome) setHistory((h) => [...h, outcome])
            setAttempt((a) => a + 1)
          }}
          onCancel={() => reset(which)}
        />
      </div>
    </div>
  )
}
