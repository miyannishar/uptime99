import { DebriefPanel, ScenarioSelect } from '../components/organisms'
import { SectionLabel } from '../components/atoms'
import { sampleDebrief, sampleScenarios } from '../fixtures/sampleRun'
import s from './OutcomePreview.module.css'

/**
 * The two screens that bracket a run: what the player picks going in, and what
 * they are told coming out.
 *
 * The debrief's "what you learned" list is built from the `teaches` field of
 * every instance played. That is the payoff of authoring `teaches` as a
 * transferable principle: collected, it reads as a set of rules rather than a
 * list of answers to puzzles already solved.
 */
export function OutcomePreview() {
  return (
    <div className={s.root}>
      <section>
        <SectionLabel aside={`${sampleScenarios.length}`}>Scenario select</SectionLabel>
        <ScenarioSelect scenarios={sampleScenarios} onPick={() => {}} />
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
