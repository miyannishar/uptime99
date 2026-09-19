import type { ScenarioSummary } from '../../types'
import { Panel } from '../atoms'
import { cx, formatMoney, layerVar } from '../../utils/format'
import s from './ScenarioSelect.module.css'

export interface ScenarioSelectProps {
  scenarios: readonly ScenarioSummary[]
  onPick?: (id: string) => void
}

/**
 * Scenario picker.
 *
 * `allowedLayers` is the difficulty curve: an early scenario opens only edge and
 * compute, so the player meets four components rather than twenty-six. The layers
 * a scenario unlocks are shown on the card because that, not a number, is what
 * actually tells the player how much system they are about to be responsible for.
 */
export function ScenarioSelect({ scenarios, onPick }: ScenarioSelectProps) {
  return (
    <div className={s.root}>
      <div className={s.grid}>
        {scenarios.map((scenario, i) => (
          <Panel
            key={scenario.id}
            className={cx(s.card, scenario.locked && s.locked)}
            interactive={!scenario.locked && Boolean(onPick)}
            onClick={!scenario.locked && onPick ? () => onPick(scenario.id) : undefined}
            role={!scenario.locked && onPick ? 'button' : undefined}
            tabIndex={!scenario.locked && onPick ? 0 : undefined}
          >
            <div className={s.top}>
              <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.stars} aria-label={`${scenario.stars} of 3 stars`}>
                {'★'.repeat(scenario.stars)}
                <span className={s.starsOff}>{'☆'.repeat(3 - scenario.stars)}</span>
              </span>
            </div>

            <h3 className={s.name}>{scenario.name}</h3>
            <p className={s.blurb}>{scenario.blurb}</p>

            <div className={s.layers}>
              {scenario.allowedLayers.map((id) => (
                <span key={id} className={s.layer} style={{ ['--layer' as string]: layerVar(id) }}>
                  {id}
                </span>
              ))}
            </div>

            <div className={s.foot}>
              <span className={s.budget}>{formatMoney(scenario.startingBudget)} to start</span>
              {scenario.locked && <span className={s.lockedTag}>locked</span>}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
