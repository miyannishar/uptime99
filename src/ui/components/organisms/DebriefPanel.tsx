import type { DebriefSummary } from '../../types'
import { Button, SectionLabel, SeverityBadge } from '../atoms'
import { LedgerRow, MetricTile, TeachesCallout } from '../molecules'
import { cx, formatMoney } from '../../utils/format'
import s from './DebriefPanel.module.css'

export interface DebriefPanelProps {
  summary: DebriefSummary
  onRetry?: () => void
  onContinue?: () => void
}

/**
 * The post-run debrief.
 *
 * The lessons list is the reason the `teaches` field is authored as a
 * transferable principle rather than a restatement of an answer: collected here,
 * it reads as a set of rules the player can carry to the next scenario, which is
 * the only outcome that matters in a teaching game. A list of "the answer was
 * 250m" lines would be worthless.
 *
 * The ledger is shown in full because every charge traces back to a `kind` and a
 * `basis` - the player can see exactly what the outage cost and why.
 */
export function DebriefPanel({ summary, onRetry, onContinue }: DebriefPanelProps) {
  const { scenarioName, cleared, ticks, finalMetrics, incidentsFaced, lessons, ledger } = summary
  const net = ledger.reduce((n, l) => n + l.amount, 0)
  const unresolved = incidentsFaced.filter((i) => !i.resolved).length

  return (
    <div className={s.root}>
      <header className={cx(s.head, cleared ? s.cleared : s.failed)}>
        <span className={s.verdict}>{cleared ? 'survived' : 'went down'}</span>
        <h2 className={s.title}>{scenarioName}</h2>
        <p className={s.sub}>
          {ticks} ticks · {incidentsFaced.length} incidents
          {unresolved > 0 && ` · ${unresolved} never resolved`}
        </p>
      </header>

      <section className={s.section}>
        <SectionLabel rule>Where you finished</SectionLabel>
        <div className={s.metrics}>
          {finalMetrics.map((reading) => (
            <MetricTile key={reading.def.id} reading={reading} />
          ))}
        </div>
      </section>

      <section className={s.section}>
        <SectionLabel rule aside={`${lessons.length}`}>What you learned</SectionLabel>
        {lessons.length === 0 ? (
          <p className={s.none}>No tasks completed - nothing to take away.</p>
        ) : (
          <div className={s.lessons}>
            {lessons.map((lesson) => (
              <TeachesCallout key={lesson.instanceId} teaches={lesson.teaches} earned />
            ))}
          </div>
        )}
      </section>

      <section className={s.section}>
        <SectionLabel rule aside={`${incidentsFaced.length}`}>Incidents</SectionLabel>
        <ul className={s.incidents}>
          {incidentsFaced.map(({ def, resolved }) => (
            <li key={def.id} className={cx(s.incident, !resolved && s.incidentOpen)}>
              <SeverityBadge severity={def.severity} family={def.family} />
              <span className={s.incidentName}>{def.name}</span>
              <span className={cx(s.outcome, resolved ? s.resolved : s.unresolved)}>
                {resolved ? 'resolved' : def.resolved_by.length === 0 ? 'survived' : 'never fixed'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.section}>
        <SectionLabel rule aside={formatMoney(net, { sign: true })}>
          Ledger
        </SectionLabel>
        <div className={s.ledger}>
          {ledger.length === 0 && <p className={s.none}>no priced events</p>}
          {ledger.map((line, i) => (
            <LedgerRow key={`${line.tick}-${line.kind}-${i}`} line={line} />
          ))}
        </div>
      </section>

      <footer className={s.foot}>
        {onRetry && (
          <Button size="md" onClick={onRetry}>
            try again
          </Button>
        )}
        {onContinue && (
          <Button variant="primary" size="md" onClick={onContinue}>
            {cleared ? 'next scenario ▶' : 'back to scenarios'}
          </Button>
        )}
      </footer>
    </div>
  )
}
