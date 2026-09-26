import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { startRun, runSession, endSession } from '../src/engine/session'
import { designSummary, debriefSummary } from '../src/engine/summary'
import type { GameState } from '../src/engine/types'

const c = loadEngineCatalog()
const fresh = () => loadScenario('slice-oom-kill', c)

// ─────────────────────────────────────────────────────── designSummary ──

describe('designSummary', () => {
  it('reports the current budget', () => {
    const s = fresh()
    const summary = designSummary(s, c)
    expect(summary.budget).toBe(s.budget)
  })

  it('computes spent as the sum of tier cost_months across all instances', () => {
    const s = fresh()
    // Manually compute expected total
    let expectedSpent = 0
    for (const inst of s.instances) {
      const def = c.nodeById.get(inst.def_id)!
      const tier = def.tiers.find((t: any) => t.tier === inst.tier)!
      expectedSpent += tier.stats.cost_month
    }

    const summary = designSummary(s, c)
    expect(summary.spent).toBe(expectedSpent)
    expect(summary.spent).toBeGreaterThan(0)
  })

  it('reports no unsatisfied ports on the shipped slice-oom-kill board', () => {
    const s = fresh()
    const summary = designSummary(s, c)
    expect(summary.unsatisfiedPorts).toHaveLength(0)
  })

  it('reports unsatisfied ports when a port is missing', () => {
    const s = fresh()
    // Remove all instances except cdn — cdn requires an origin port
    const onlyCdn = { ...s, instances: s.instances.filter((i) => i.def_id === 'cdn') }
    const summary = designSummary(onlyCdn as GameState, c)
    expect(summary.unsatisfiedPorts.length).toBeGreaterThan(0)
    const portIds = summary.unsatisfiedPorts.map((p) => `${p.instance_id}.${p.port}`)
    expect(portIds).toContain('cdn-1.origin')
  })

  it('collects exposed weakness tag ids from tier definitions', () => {
    const s = fresh()
    const summary = designSummary(s, c)
    // app_cluster tier 1 has tags: spof, no_autoscale — check these are weakness kind
    const spofTag = c.tagById.get('spof')
    const noAutoscaleTag = c.tagById.get('no_autoscale')

    if (spofTag?.kind === 'weakness') {
      expect(summary.exposedWeaknessIds).toContain('spof')
    }
    if (noAutoscaleTag?.kind === 'weakness') {
      expect(summary.exposedWeaknessIds).toContain('no_autoscale')
    }

    // All reported ids should be actual weakness tags
    for (const id of summary.exposedWeaknessIds) {
      expect(c.tagById.get(id)?.kind).toBe('weakness')
    }
  })

  it('does not include non-weakness tags in exposedWeaknessIds', () => {
    const s = fresh()
    const summary = designSummary(s, c)
    // 'stateless' is a property tag, not a weakness
    expect(summary.exposedWeaknessIds).not.toContain('stateless')
  })
})

// ─────────────────────────────────────────────────────── debriefSummary ──

describe('debriefSummary', () => {
  it('includes the scenario name', () => {
    const s = endSession(startRun(fresh(), c))
    const summary = debriefSummary(s, c)
    expect(summary.scenario_name).toBe('First Incident')
  })

  it('reports cleared = false when reputation is zero', () => {
    // Patch reputation to 0 to test the cleared condition independent of decay rate
    const s = runSession(startRun(fresh(), c), c)
    const zeroRep = { ...s, carried: { ...s.carried, reputation: 0 } }
    const summary = debriefSummary(zeroRep, c)
    expect(summary.cleared).toBe(false)
  })

  it('reports cleared = true when complete with reputation above zero', () => {
    // cleared = survived the window with reputation > 0 (incidents don't need to be resolved)
    const ran = runSession(startRun(fresh(), c), c)
    const highRep = { ...ran, carried: { ...ran.carried, reputation: 50 } }
    const summary = debriefSummary(highRep, c)
    expect(summary.cleared).toBe(true)
  })

  it('reports the final tick count', () => {
    const s = runSession(startRun(fresh(), c), c)
    const summary = debriefSummary(s, c)
    expect(summary.ticks).toBe(40)
  })

  it('reports incident counts', () => {
    const s = runSession(startRun(fresh(), c), c)
    const summary = debriefSummary(s, c)
    expect(summary.incidents_fired).toBe(1)
    // oom_kill was never resolved in the golden run
    expect(summary.incidents_resolved).toBe(0)
  })

  it('reports the final budget', () => {
    const s = runSession(startRun(fresh(), c), c)
    const summary = debriefSummary(s, c)
    expect(summary.final_budget).toBe(s.budget)
  })

  it('reports final reputation and users from carried', () => {
    const s = runSession(startRun(fresh(), c), c)
    const summary = debriefSummary(s, c)
    expect(summary.final_reputation).toBe(s.carried.reputation)
    expect(summary.final_users).toBe(s.carried.users)
  })

  it('includes the full ledger', () => {
    const s = runSession(startRun(fresh(), c), c)
    const summary = debriefSummary(s, c)
    expect(summary.ledger).toBe(s.ledger)
    expect(Array.isArray(summary.ledger)).toBe(true)
  })

  it('falls back to scenario_id as name when scenario not found', () => {
    const s = endSession(startRun(fresh(), c))
    const unknownScenario = { ...s, scenario_id: 'unknown-scenario-id' }
    const summary = debriefSummary(unknownScenario, c)
    expect(summary.scenario_name).toBe('unknown-scenario-id')
  })
})
