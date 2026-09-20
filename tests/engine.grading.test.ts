import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { advance } from '../src/engine/tick'
import { gradeAnswer, applyOutcome, type MinigameAnswer } from '../src/engine/grading'
import type { GameState } from '../src/engine/types'

const c = loadEngineCatalog()

const appClusterId = 'app-cluster-1'

/** Run to tick 13 so oom_kill has fired and app-cluster-1 is at health 30. */
const runWithOom = (): GameState => {
  const s = { ...loadScenario('slice-oom-kill', c), phase: 'run' as const, rng_seed: 4242 }
  return advance(s, 13, c)
}

// ────────────────────────────────────────────────────────────── gradeAnswer ──

describe('gradeAnswer — ordered_sequence', () => {
  // Use the cutover_lower_ttl_first instance: solution.order = [1, 2, 3, 0]
  const inst = c.minigameInstances.find((m: any) => m.id === 'cutover_lower_ttl_first')!

  it('marks the correct order as correct', () => {
    const answer: MinigameAnswer = { kind: 'ordered_sequence', order: [1, 2, 3, 0] }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(true)
    expect(result.when).toBeUndefined()
  })

  it('marks a wrong order as wrong with when=wrong_order', () => {
    const answer: MinigameAnswer = { kind: 'ordered_sequence', order: [0, 1, 2, 3] }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_order')
  })
})

describe('gradeAnswer — fill_blank', () => {
  // Use yaml_replicas_for_load: solution.blanks = { "1": "6" }
  const inst = c.minigameInstances.find((m: any) => m.id === 'yaml_replicas_for_load')!

  it('marks the correct blank as correct (case-insensitive, trimmed)', () => {
    const answer: MinigameAnswer = { kind: 'fill_blank', blanks: { '1': '6' } }
    expect(gradeAnswer(inst, answer).correct).toBe(true)
  })

  it('marks a wrong blank as wrong with when=wrong_value', () => {
    const answer: MinigameAnswer = { kind: 'fill_blank', blanks: { '1': '4' } }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_value')
  })

  it('marks a missing key as wrong', () => {
    const answer: MinigameAnswer = { kind: 'fill_blank', blanks: {} }
    expect(gradeAnswer(inst, answer).correct).toBe(false)
  })
})

describe('gradeAnswer — dial', () => {
  // Use queue_workers_for_arrival: solution.value = 5
  const inst = c.minigameInstances.find((m: any) => m.id === 'queue_workers_for_arrival')!

  it('marks the exact value as correct', () => {
    const answer: MinigameAnswer = { kind: 'dial', value: 5 }
    expect(gradeAnswer(inst, answer).correct).toBe(true)
  })

  it('marks a value below the answer as below', () => {
    const answer: MinigameAnswer = { kind: 'dial', value: 3 }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('below')
  })

  it('marks a value above the answer as above', () => {
    const answer: MinigameAnswer = { kind: 'dial', value: 10 }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('above')
  })
})

describe('gradeAnswer — wiring', () => {
  // Use topology_second_az: solution = { zone: "us-east-1b", connect_to: ["lb", "pg"] }
  const inst = c.minigameInstances.find((m: any) => m.id === 'topology_second_az')!

  it('marks the correct zone and connections as correct', () => {
    const answer: MinigameAnswer = {
      kind: 'wiring',
      zone: 'us-east-1b',
      connectTo: ['lb', 'pg'],
    }
    expect(gradeAnswer(inst, answer).correct).toBe(true)
  })

  it('marks a wrong zone as wrong_target', () => {
    const answer: MinigameAnswer = {
      kind: 'wiring',
      zone: 'us-east-1a',
      connectTo: ['lb', 'pg'],
    }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_target')
  })

  it('marks wrong connections as wrong_target', () => {
    const answer: MinigameAnswer = {
      kind: 'wiring',
      zone: 'us-east-1b',
      connectTo: ['lb'],  // missing pg
    }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_target')
  })

  it('accepts connections in any order', () => {
    const answer: MinigameAnswer = {
      kind: 'wiring',
      zone: 'us-east-1b',
      connectTo: ['pg', 'lb'],  // reversed order
    }
    expect(gradeAnswer(inst, answer).correct).toBe(true)
  })
})

describe('gradeAnswer — evidence', () => {
  // Use log_oom_killer: solution.choice = "Increase the container memory limit..."
  const inst = c.minigameInstances.find((m: any) => m.id === 'log_oom_killer')!

  it('marks the correct choice as correct', () => {
    const answer: MinigameAnswer = {
      kind: 'evidence',
      choice: inst.solution.choice,
    }
    expect(gradeAnswer(inst, answer).correct).toBe(true)
  })

  it('marks a wrong choice as wrong with when=wrong_choice', () => {
    const answer: MinigameAnswer = {
      kind: 'evidence',
      choice: 'some other explanation',
    }
    const result = gradeAnswer(inst, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_choice')
  })

  it('marks null choice as wrong', () => {
    const answer: MinigameAnswer = { kind: 'evidence', choice: null }
    expect(gradeAnswer(inst, answer).correct).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────── applyOutcome ──

describe('applyOutcome', () => {
  it('applies health_delta on success and clamps to 100', () => {
    const s = runWithOom()
    const app = s.instances.find((i) => i.instance_id === appClusterId)!
    expect(app.health).toBe(30) // after oom_kill -70

    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: null,
        correct: true,
      },
      c,
    )

    const newApp = next.instances.find((i) => i.instance_id === appClusterId)!
    // restart on_success.health_delta = +60
    expect(newApp.health).toBe(30 + 60) // restart now gives +60
  })

  it('applies health_delta on fail', () => {
    const s = runWithOom()
    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: null,
        correct: false,
      },
      c,
    )

    const newApp = next.instances.find((i) => i.instance_id === appClusterId)!
    // restart on_fail.health_delta = -10; 30 - 10 = 20
    expect(newApp.health).toBe(20)
  })

  it('clamps health to 0 minimum', () => {
    const s = runWithOom()
    const lowHealthInst = {
      ...s.instances.find((i) => i.instance_id === appClusterId)!,
      health: 5,
    }
    const patchedState: GameState = {
      ...s,
      instances: s.instances.map((i) =>
        i.instance_id === appClusterId ? lowHealthInst : i,
      ),
    }
    const next = applyOutcome(
      patchedState,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: null,
        correct: false,
      },
      c,
    )
    const newApp = next.instances.find((i) => i.instance_id === appClusterId)!
    expect(newApp.health).toBe(0) // 5 - 10 clamped to 0
  })

  it('sets cooldown on the action after outcome', () => {
    const s = runWithOom()
    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: null,
        correct: true,
      },
      c,
    )
    const newApp = next.instances.find((i) => i.instance_id === appClusterId)!
    // restart.cooldown_s = 90
    expect(newApp.action_cooldowns['restart']).toBe(90)
  })

  it('decrements budget by cost_delta on success', () => {
    // vertical_scale on_success.cost_delta = 30
    const s = runWithOom()
    const initialBudget = s.budget
    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'vertical_scale',
        minigameInstanceId: 'resource_sizing_1',
        incidentKey: null,
        correct: true,
      },
      c,
    )
    expect(next.budget).toBe(initialBudget - 30)
  })

  it('removes the incident and increments incidents_resolved when correct', () => {
    const s = runWithOom()
    const oomRecord = s.incidents.find((r) => r.incident_id === 'oom_kill')!
    expect(oomRecord).toBeDefined()

    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: oomRecord.key,
        correct: true,
      },
      c,
    )

    expect(next.incidents.find((r) => r.incident_id === 'oom_kill')).toBeUndefined()
    expect(next.session.incidents_resolved).toBe(s.session.incidents_resolved + 1)
  })

  it('does NOT remove the incident when wrong', () => {
    const s = runWithOom()
    const oomRecord = s.incidents.find((r) => r.incident_id === 'oom_kill')!

    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: oomRecord.key,
        correct: false,
      },
      c,
    )

    expect(next.incidents.find((r) => r.incident_id === 'oom_kill')).toBeDefined()
    expect(next.session.incidents_resolved).toBe(s.session.incidents_resolved)
  })

  it('appends on_resolve ledger entries when incident is resolved', () => {
    const s = runWithOom()
    const oomRecord = s.incidents.find((r) => r.incident_id === 'oom_kill')!
    const ledgerBefore = s.ledger.length

    const next = applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: oomRecord.key,
        correct: true,
      },
      c,
    )

    // oom_kill has one ledger_event with when=on_resolve
    expect(next.ledger.length).toBeGreaterThan(ledgerBefore)
    const resolveEntry = next.ledger.find((e) => e.kind === 'incident_remediation')
    expect(resolveEntry).toBeDefined()
  })

  it('never mutates the input state', () => {
    const s = runWithOom()
    const before = structuredClone(s)
    const oomRecord = s.incidents.find((r) => r.incident_id === 'oom_kill')!

    applyOutcome(
      s,
      {
        instanceId: appClusterId,
        actionId: 'restart',
        minigameInstanceId: 'log_oom_killer',
        incidentKey: oomRecord.key,
        correct: true,
      },
      c,
    )

    expect(s).toEqual(before)
  })

  it('throws for an unknown action id', () => {
    const s = runWithOom()
    expect(() =>
      applyOutcome(
        s,
        {
          instanceId: appClusterId,
          actionId: 'no_such_action',
          minigameInstanceId: 'log_oom_killer',
          incidentKey: null,
          correct: true,
        },
        c,
      ),
    ).toThrow(/unknown action id/)
  })

  it('throws for an unknown instance id', () => {
    const s = runWithOom()
    expect(() =>
      applyOutcome(
        s,
        {
          instanceId: 'no-such-instance',
          actionId: 'restart',
          minigameInstanceId: 'log_oom_killer',
          incidentKey: null,
          correct: true,
        },
        c,
      ),
    ).toThrow(/unknown instance id/)
  })
})
