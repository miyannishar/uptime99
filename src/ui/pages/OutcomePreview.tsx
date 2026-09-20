import { DebriefPanel, ScenarioSelect } from '../components/organisms'
import { SectionLabel } from '../components/atoms'
import { sampleDebrief } from '../fixtures/sampleRun'
import { adaptScenarios } from '../adapt'
import s from './OutcomePreview.module.css'

const scenarios = adaptScenarios()

/**
 * The two screens that bracket a run: what the player picks going in, and what
 * they are told coming out. Scenarios come from the real engine catalog.
 * The debrief panel still shows a fixture summary until debriefSummary is wired
 * through a completed run.
 */
export function OutcomePreview() {
  return (
    <div className={s.root}>
      <section>
        <SectionLabel aside={`${scenarios.length}`}>Scenario select</SectionLabel>
        <ScenarioSelect scenarios={scenarios} onPick={() => {}} />
      </section>

      <section>
        <SectionLabel rule>Debrief</SectionLabel>
        <div className={s.stage}>
          <DebriefPanel summary={sampleDebrief} onRetry={() => {}} onContinue={() => {}} />
        </div>
      </section>
    </div>
  )
}
