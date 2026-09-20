import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import {
  targetsOf, weightOf, eligibleIncidents, selectIncident, shouldArrive,
} from '../src/engine/arrival'
import type { GameState } from '../src/engine/types'

const c = loadEngineCatalog()
const base = loadScenario('slice-oom-kill', c)
const easy = { arrival_mean_ticks: 40, severity_max: 2, max_concurrent: 1 }
const hard = { arrival_mean_ticks: 12, severity_max: 5, max_concurrent: 3 }
const at = (over: Partial<GameState> = {}): GameState =>
  ({ ...base, phase: 'run', ...over }) as GameState

describe('targetsOf', () => {
  it('finds the compute instance for oom_kill, which targets the compute layer', () => {
    const inc = c.incidentById.get('oom_kill')!
    expect(targetsOf(inc, at({ tick: 50 }), c).map((i) => i.instance_id))
      .toEqual(['app-cluster-1'])
  })

  it('returns an empty list when nothing matches', () => {
    const inc = c.incidentById.get('oom_kill')!
    const noCompute = at({ instances: base.instances.filter((i) => i.def_id !== 'app_cluster') })
    expect(targetsOf(inc, noCompute, c)).toEqual([])
  })
})

describe('weightOf', () => {
  it('is base_weight plus weight_per_target per matching target', () => {
    const inc = c.incidentById.get('oom_kill')!  // base 14, per_target 3
    expect(weightOf(inc, [{} as any])).toBe(17)
    expect(weightOf(inc, [{} as any, {} as any])).toBe(20)
  })

  it('is zero with no targets, making the incident ineligible', () => {
    expect(weightOf(c.incidentById.get('oom_kill')!, [])).toBe(0)
  })

  it('returns exactly base_weight for an architecture incident regardless of target count', () => {
    // Architecture incidents carry weight_per_target: 0 by design, so the
    // weight_per_target term contributes nothing; the presence in the pool is
    // scaled by base_weight alone. Silently adding weight_per_target terms would
    // overweight them — this asserts the invariant that weight_per_target is 0
    // and that weightOf reflects it for any non-zero target count.
    const archInc = c.incidents.find((i: any) => i.scope === 'architecture')!
    expect(archInc.weight_per_target).toBe(0)
    expect(weightOf(archInc, [{} as any])).toBe(archInc.base_weight)
    expect(weightOf(archInc, [{} as any, {} as any])).toBe(archInc.base_weight)
  })
})

describe('eligibleIncidents', () => {
  it('admits only incidents at or below severity_max', () => {
    const out = eligibleIncidents(at({ tick: 200 }), c, easy)
    expect(out.every((i) => i.severity <= 2)).toBe(true)
    expect(out.length).toBeGreaterThan(0)
  })

  it('admits more at a higher severity_max', () => {
    const lo = eligibleIncidents(at({ tick: 200 }), c, easy).length
    const hi = eligibleIncidents(at({ tick: 200 }), c, hard).length
    expect(hi).toBeGreaterThan(lo)
  })

  it('excludes an incident whose min_tick has not been reached', () => {
    // oom_kill gates min_tick 10
    const early = eligibleIncidents(at({ tick: 0 }), c, hard)
    expect(early.map((i) => i.id)).not.toContain('oom_kill')
    const later = eligibleIncidents(at({ tick: 50 }), c, hard)
    expect(later.map((i) => i.id)).toContain('oom_kill')
  })

  it('excludes an incident whose min_users is not met', () => {
    const gated = c.incidents.find((i: any) => i.gates.min_users >= 10000)!
    const small = at({ tick: 300, carried: { reputation: 100, users: 100 } })
    expect(eligibleIncidents(small, c, hard).map((i) => i.id)).not.toContain(gated.id)
  })

  it('excludes an incident still inside its cooldown window', () => {
    const s = at({ tick: 100, last_fired: { oom_kill: 80 } })  // cooldown 60
    expect(eligibleIncidents(s, c, hard).map((i) => i.id)).not.toContain('oom_kill')
    const after = at({ tick: 200, last_fired: { oom_kill: 80 } })
    expect(eligibleIncidents(after, c, hard).map((i) => i.id)).toContain('oom_kill')
  })

  it('excludes an incident with no matching target', () => {
    const noCompute = at({
      tick: 300,
      instances: base.instances.filter((i) => i.def_id !== 'app_cluster'),
    })
    expect(eligibleIncidents(noCompute, c, hard).map((i) => i.id)).not.toContain('oom_kill')
  })

  it('never admits the same incident twice while it is already active', () => {
    const active = at({
      tick: 300,
      incidents: [{
        key: 'oom_kill#1', incident_id: 'oom_kill', instance_id: 'app-cluster-1',
        started_tick: 290, escalate_at_tick: null, expires_at_tick: null, attempts: {},
      }],
    })
    expect(eligibleIncidents(active, c, hard).map((i) => i.id)).not.toContain('oom_kill')
  })

  it('admits an architecture-scope incident when severity and gates allow it', () => {
    // Architecture incidents have target: null; they are gated on severity and
    // gates alone, with no weight check. Silently excluding them would drop 9 of 49
    // incidents from weighted play with a passing test suite.
    const archInc = c.incidents.find((i: any) => i.scope === 'architecture' && i.severity <= 2)!
    const s = at({ tick: 300 })
    const eligible = eligibleIncidents(s, c, { ...easy, severity_max: 2 })
    expect(eligible.map((i: any) => i.id)).toContain(archInc.id)
  })
})

describe('selectIncident', () => {
  it('returns null when nothing is eligible', () => {
    const none = at({ tick: 0, carried: { reputation: 100, users: 0 } })
    expect(selectIncident(none, c, { ...easy, severity_max: 1 }, { seed: 1 }).incident).toBeNull()
  })

  it('is deterministic for a given seed', () => {
    const s = at({ tick: 300 })
    const a = selectIncident(s, c, hard, { seed: 4242 })
    const b = selectIncident(s, c, hard, { seed: 4242 })
    expect(a.incident?.id).toBe(b.incident?.id)
  })

  it('advances the rng so successive selections can differ', () => {
    const s = at({ tick: 300 })
    const first = selectIncident(s, c, hard, { seed: 11 })
    expect(first.rng.seed).not.toBe(11)
  })

  it('only ever returns an eligible incident', () => {
    const s = at({ tick: 300 })
    let rng = { seed: 5 }
    const allowed = new Set(eligibleIncidents(s, c, easy).map((i) => i.id))
    for (let n = 0; n < 60; n += 1) {
      const out = selectIncident(s, c, easy, rng)
      if (out.incident) expect(allowed.has(out.incident.id)).toBe(true)
      rng = out.rng
    }
  })

  it('favours heavier incidents over many draws', () => {
    const s = at({ tick: 300 })
    const pool = eligibleIncidents(s, c, easy)
    const heaviest = pool.reduce((a, b) =>
      weightOf(b, targetsOf(b, s, c)) > weightOf(a, targetsOf(a, s, c)) ? b : a)
    const lightest = pool.reduce((a, b) =>
      weightOf(b, targetsOf(b, s, c)) < weightOf(a, targetsOf(a, s, c)) ? b : a)
    const heaviestWeight = weightOf(heaviest, targetsOf(heaviest, s, c))
    const total = pool.reduce((sum, inc) => sum + weightOf(inc, targetsOf(inc, s, c)), 0)
    const TRIALS = 1500
    let rng = { seed: 777 }
    const counts: Record<string, number> = {}
    for (let n = 0; n < TRIALS; n += 1) {
      const out = selectIncident(s, c, easy, rng)
      if (out.incident) counts[out.incident.id] = (counts[out.incident.id] ?? 0) + 1
      rng = out.rng
    }
    // the heaviest must be drawn at all and the pool must be varied
    expect(counts[heaviest.id]).toBeGreaterThan(0)
    expect(Object.keys(counts).length).toBeGreaterThan(1)
    // observed share must be at least half the weight-implied share
    // (0.5 slack: seeded but statistically-sampled assertion; tighter would be flaky)
    expect(counts[heaviest.id] / TRIALS).toBeGreaterThanOrEqual((heaviestWeight / total) * 0.5)
    // ordering property: heaviest must beat lightest — a uniform draw fails this
    expect(counts[heaviest.id]).toBeGreaterThan(counts[lightest.id] ?? 0)
  })
})

describe('shouldArrive', () => {
  it('is deterministic', () => {
    expect(shouldArrive(easy, { seed: 3 }).arrive).toBe(shouldArrive(easy, { seed: 3 }).arrive)
  })

  it('fires more often at a shorter arrival_mean_ticks', () => {
    const count = (d: typeof easy) => {
      let rng = { seed: 8080 }
      let n = 0
      for (let i = 0; i < 4000; i += 1) {
        const out = shouldArrive(d, rng)
        if (out.arrive) n += 1
        rng = out.rng
      }
      return n
    }
    expect(count(hard)).toBeGreaterThan(count(easy))
  })

  it('arrives roughly once per arrival_mean_ticks', () => {
    let rng = { seed: 1234 }
    let n = 0
    const ticks = 4000
    for (let i = 0; i < ticks; i += 1) {
      const out = shouldArrive(easy, rng)
      if (out.arrive) n += 1
      rng = out.rng
    }
    const mean = ticks / n
    expect(mean).toBeGreaterThan(easy.arrival_mean_ticks * 0.6)
    expect(mean).toBeLessThan(easy.arrival_mean_ticks * 1.6)
  })
})
