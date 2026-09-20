import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { affectedInstanceIds, applyDamage } from '../src/engine/damage'
import { targetsOf } from '../src/engine/arrival'
import { seedFrom } from '../src/engine/rng'
import { deriveMetrics } from '../src/engine/metrics'

const c = loadEngineCatalog()
const base = loadScenario('slice-oom-kill', c)

describe('affectedInstanceIds', () => {
  // Finding 2a: traffic_spike matches cdn-1, load-balancer-1, app-cluster-1 on this board
  it('instance scope picks exactly one of several matching targets', () => {
    const inc = c.incidentById.get('traffic_spike')!
    const out = affectedInstanceIds(inc, base, c, { seed: 1 })
    expect(out.ids).toHaveLength(1)
    const validTargets = new Set(['cdn-1', 'load-balancer-1', 'app-cluster-1'])
    expect(validTargets.has(out.ids[0])).toBe(true)
  })

  // Finding 2b: use seedFrom to produce well-distributed seeds; small integers
  // produce near-zero floats from xorshift32 and always pick index 0.
  it('instance scope draws different victims across seeds', () => {
    const inc = c.incidentById.get('traffic_spike')!
    const validTargets = new Set(['cdn-1', 'load-balancer-1', 'app-cluster-1'])
    const seen = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      const out = affectedInstanceIds(inc, base, c, { seed: seedFrom('s' + i) })
      expect(out.ids).toHaveLength(1)
      expect(validTargets.has(out.ids[0])).toBe(true)
      seen.add(out.ids[0])
    }
    // A targets[0] stub always returns cdn-1; the real draw spreads across all 3.
    // Observed Set size across 50 seedFrom seeds: 3.
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  // Finding 2c: use traffic_spike (multi-target) so determinism is a real claim
  // about the seeded draw, not an artefact of having one candidate.
  it('instance scope is deterministic for a given seed', () => {
    const inc = c.incidentById.get('traffic_spike')!
    const seed = seedFrom('determinism-check')
    const a = affectedInstanceIds(inc, base, c, { seed })
    const b = affectedInstanceIds(inc, base, c, { seed })
    const d = affectedInstanceIds(inc, base, c, { seed })
    expect(a.ids).toEqual(b.ids)
    expect(b.ids).toEqual(d.ids)
  })

  it('returns nothing for architecture scope', () => {
    const arch = c.incidents.find((i: any) => i.scope === 'architecture')!
    expect(affectedInstanceIds(arch, base, c, { seed: 1 }).ids).toEqual([])
  })

  // Finding 1a: az_outage is group/region scope; on this board it matches
  // app-cluster-1 and postgres-1 (both in region us-east-1a, compute + data layers).
  // The assertion names the exact full set, proving "every" not "a subset".
  it('group scope returns every target sharing the drawn group key, not a subset', () => {
    const grp = c.incidentById.get('az_outage')!
    const out = affectedInstanceIds(grp, base, c, { seed: 2 })
    expect([...out.ids].sort()).toEqual(['app-cluster-1', 'postgres-1'])
  })

  // Finding 1b: provider_outage is group/def_id scope. Assert the returned ids
  // are exactly the full set of targets sharing the drawn def_id — no subset allowed.
  it('group scope with group_by: def_id selects one def, not one instance', () => {
    const grp = c.incidentById.get('provider_outage')!
    const out = affectedInstanceIds(grp, base, c, { seed: 3 })
    // All returned ids must share a single def_id
    const defIds = new Set(out.ids.map((id) => base.instances.find((i) => i.instance_id === id)!.def_id))
    expect(defIds.size).toBe(1)
    // The returned set must equal the full set of targets carrying that def_id
    const drawnDefId = [...defIds][0]
    const expectedFull = targetsOf(grp, base, c)
      .filter((t) => t.def_id === drawnDefId)
      .map((t) => t.instance_id)
      .sort()
    expect([...out.ids].sort()).toEqual(expectedFull)
  })
})

describe('applyDamage', () => {
  it('applies health_delta to the affected instance only', () => {
    const inc = c.incidentById.get('oom_kill')!   // health_delta -70
    const out = applyDamage(base, inc, ['app-cluster-1'])
    const app = out.instances.find((i) => i.instance_id === 'app-cluster-1')!
    const pg = out.instances.find((i) => i.instance_id === 'postgres-1')!
    expect(app.health).toBe(30)
    expect(pg.health).toBe(100)
  })

  it('applies utilization_delta_pct', () => {
    const inc = c.incidentById.get('oom_kill')!   // utilization_delta_pct 25
    const out = applyDamage(base, inc, ['app-cluster-1'])
    expect(out.instances.find((i) => i.instance_id === 'app-cluster-1')!.utilization_pct).toBe(25)
  })

  it('clamps health at 0 and never below', () => {
    const harsh = c.incidents.find((i: any) => i.damage.health_delta === -100)!
    const out = applyDamage(base, harsh, ['app-cluster-1'])
    expect(out.instances.find((i) => i.instance_id === 'app-cluster-1')!.health).toBe(0)
  })

  it('lets utilization exceed 100, because that is what drives error_rate', () => {
    const hot = { ...base, instances: base.instances.map((i) =>
      i.instance_id === 'app-cluster-1' ? { ...i, utilization_pct: 90 } : i) }
    const inc = c.incidentById.get('oom_kill')!
    const out = applyDamage(hot, inc, ['app-cluster-1'])
    expect(out.instances.find((i) => i.instance_id === 'app-cluster-1')!.utilization_pct)
      .toBeGreaterThan(100)
    expect(deriveMetrics(out, c).error_rate_pct).toBeGreaterThan(0)
  })

  it('sets down when the incident says so, and uptime falls', () => {
    const killer = c.incidents.find((i: any) => i.damage.down === true)!
    const targets = affectedInstanceIds(killer, base, c, { seed: 1 }).ids
    if (targets.length === 0) return   // not targetable on this board
    const out = applyDamage(base, killer, targets)
    expect(out.instances.find((i) => i.instance_id === targets[0])!.down).toBe(true)
    expect(deriveMetrics(out, c).uptime_pct).toBeLessThan(100)
  })

  it('adds runtime tags without touching definition tags', () => {
    const tagger = c.incidents.find((i: any) => (i.damage.tags_add ?? []).length > 0)!
    const targets = affectedInstanceIds(tagger, base, c, { seed: 3 }).ids
    if (targets.length === 0) return
    const out = applyDamage(base, tagger, targets)
    const hit = out.instances.find((i) => i.instance_id === targets[0])!
    for (const t of tagger.damage.tags_add) expect(hit.tags_runtime).toContain(t)
  })

  it('does not duplicate a tag already present', () => {
    const tagger = c.incidents.find((i: any) => (i.damage.tags_add ?? []).length > 0)!
    const targets = affectedInstanceIds(tagger, base, c, { seed: 3 }).ids
    if (targets.length === 0) return
    const once = applyDamage(base, tagger, targets)
    const twice = applyDamage(once, tagger, targets)
    const hit = twice.instances.find((i) => i.instance_id === targets[0])!
    const tag = tagger.damage.tags_add[0]
    expect(hit.tags_runtime.filter((t) => t === tag)).toHaveLength(1)
  })

  it('changes nothing for architecture scope', () => {
    const arch = c.incidents.find((i: any) => i.scope === 'architecture')!
    expect(applyDamage(base, arch, []).instances).toEqual(base.instances)
  })

  it('never mutates the input state', () => {
    const inc = c.incidentById.get('oom_kill')!
    const before = structuredClone(base.instances)
    applyDamage(base, inc, ['app-cluster-1'])
    expect(base.instances).toEqual(before)
  })
})
