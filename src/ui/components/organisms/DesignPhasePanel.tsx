import type { DesignSummary } from '../../types'
import { Button, SectionLabel } from '../atoms'
import { BudgetMeter, MetricTile, TagList } from '../molecules'
import s from './DesignPhasePanel.module.css'

export interface DesignPhasePanelProps {
  summary: DesignSummary
  onCommit?: () => void
  /** Blocks commit and says why. */
  blockedReason?: string
}

/**
 * The untimed phase readout.
 *
 * The projected metrics are the whole point of having a design phase: the player
 * gets to see what their architecture will do before an incident tells them. Each
 * number is derived from the tier stats on the board - no projection is authored
 * anywhere, so it cannot drift from what the tiers actually cost.
 *
 * Unsatisfied required ports block the commit rather than failing later, and
 * exposed weaknesses are listed by name because every one of them is something
 * some incident in the catalog is specifically hunting.
 */
export function DesignPhasePanel({ summary, onCommit, blockedReason }: DesignPhasePanelProps) {
  const { budget, spent, projected, exposedWeaknesses, unsatisfiedPorts } = summary
  const blocked = Boolean(blockedReason) || unsatisfiedPorts.length > 0

  return (
    <div className={s.root}>
      <SectionLabel aside="untimed">Design</SectionLabel>

      <BudgetMeter budget={budget} startingBudget={budget + spent} pending={spent} />

      <section className={s.section}>
        <SectionLabel rule>Projected</SectionLabel>
        <div className={s.metrics}>
          {projected.map((reading) => (
            <MetricTile key={reading.def.id} reading={reading} />
          ))}
        </div>
      </section>

      <section className={s.section}>
        <SectionLabel rule aside={`${exposedWeaknesses.length}`}>
          Exposed weaknesses
        </SectionLabel>
        {exposedWeaknesses.length === 0 ? (
          <p className={s.clean}>Nothing on this board carries a weakness tag.</p>
        ) : (
          <>
            <TagList tags={exposedWeaknesses} />
            <p className={s.hint}>
              Every one of these is something an incident in the catalog specifically targets.
            </p>
          </>
        )}
      </section>

      {unsatisfiedPorts.length > 0 && (
        <section className={s.section}>
          <SectionLabel rule>Wiring incomplete</SectionLabel>
          <ul className={s.problems}>
            {unsatisfiedPorts.map(({ node, port }) => (
              <li key={`${node.inst.instance_id}:${port.port.port}`} className={s.problem}>
                <b>{node.def.name}</b> needs {port.port.min}× {port.port.port} - has{' '}
                {port.filled.length}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={s.foot}>
        {blockedReason && <p className={s.blocked}>{blockedReason}</p>}
        <Button variant="primary" size="md" block disabled={blocked || !onCommit} onClick={onCommit}>
          commit and run ▶
        </Button>
      </footer>
    </div>
  )
}
