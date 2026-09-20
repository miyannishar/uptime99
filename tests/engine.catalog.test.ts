import { describe, it, expect } from 'vitest'
import { loadEngineCatalog, deepFreeze } from '../src/engine/catalog'

const c = loadEngineCatalog()

describe('loadEngineCatalog', () => {
  it('loads the shipped catalogue at its known sizes', () => {
    expect(c.nodes).toHaveLength(26)
    expect(c.layers).toHaveLength(7)
    expect(c.tags).toHaveLength(47)
    expect(c.actions).toHaveLength(33)
    expect(c.metrics).toHaveLength(7)
    expect(c.incidents).toHaveLength(49)
    expect(c.formats).toHaveLength(5)
    expect(c.minigames).toHaveLength(15)
    expect(c.minigameInstances).toHaveLength(29)
    expect(c.scenarios).toHaveLength(1)
  })

  it('indexes by id', () => {
    expect(c.nodeById.get('app_cluster')?.layer).toBe('compute')
    expect(c.metricById.get('p95_latency_ms')?.unit).toBe('ms')
    expect(c.incidentById.get('oom_kill')?.scope).toBe('instance')
    expect(c.scenarioById.get('slice-oom-kill')?.name).toBe('First Incident')
  })

  it('scenarios are frozen and reference-stable', () => {
    const s1 = c.scenarioById.get('slice-oom-kill')
    const s2 = c.scenarios.find((s: any) => s.id === 'slice-oom-kill')
    expect(s1).toBe(s2)
    expect(Object.isFrozen(s1)).toBe(true)
    expect(Object.isFrozen(s1?.board)).toBe(true)
  })

  it('exposes the economy constants the formulas need', () => {
    expect(c.economy.saturation_knee).toBe(0.8)
    expect(c.economy.saturation_exponent).toBe(3.0)
    expect(c.economy.starting_budget).toBe(800)
    expect(c.economy.tick_seconds).toBe(5)
  })

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.nodes)).toBe(true)
    expect(Object.isFrozen(c.nodes[0])).toBe(true)
    expect(Object.isFrozen(c.nodes[0].tiers[0])).toBe(true)
    expect(Object.isFrozen(c.nodes[0].tiers[0].stats)).toBe(true)
  })

  it('throws when a definition is mutated, enforcing the two-layer rule', () => {
    expect(() => { (c.nodes[0] as any).layer = 'nonsense' }).toThrow()
    expect(() => { (c.nodes[0].tiers[0].stats as any).cost_month = 1 }).toThrow()
  })

  it('shares definition references between arrays and Maps (identity check)', () => {
    // Critical: indexes must be built from the same loaded references, not fresh loadJson calls
    const edgeLayer = c.layers.find((l: any) => l.id === 'edge')
    const edgeFromMap = c.layerById.get('edge')
    expect(edgeFromMap).toBe(edgeLayer) // same object reference

    const p95Metric = c.metrics.find((m: any) => m.id === 'p95_latency_ms')
    const p95FromMap = c.metricById.get('p95_latency_ms')
    expect(p95FromMap).toBe(p95Metric) // same object reference

    const oomIncident = c.incidents.find((i: any) => i.id === 'oom_kill')
    const oomFromMap = c.incidentById.get('oom_kill')
    expect(oomFromMap).toBe(oomIncident) // same object reference
  })

  it('throws when a definition is mutated through Map access', () => {
    // Mutations through the Map entries should also throw, because they point to the same frozen objects
    const edgeLayer = c.layerById.get('edge')
    expect(() => { (edgeLayer as any).on_request_path = false }).toThrow()

    const p95Metric = c.metricById.get('p95_latency_ms')
    expect(() => { (p95Metric as any).unit = 'different' }).toThrow()

    const oomIncident = c.incidentById.get('oom_kill')
    expect(() => { (oomIncident as any).scope = 'architecture' }).toThrow()
  })
})

describe('deepFreeze', () => {
  it('freezes nested arrays and objects', () => {
    const o = deepFreeze({ a: [{ b: 1 }] })
    expect(Object.isFrozen(o.a[0])).toBe(true)
  })

  it('survives a cycle without recursing forever', () => {
    const a: any = { name: 'a' }
    a.self = a
    expect(() => deepFreeze(a)).not.toThrow()
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('freezes Map values', () => {
    const m = deepFreeze(new Map([['key', { value: 1 }]]))
    expect(Object.isFrozen(m)).toBe(true)
    expect(Object.isFrozen(m.get('key'))).toBe(true)
  })

  it('freezes Set values', () => {
    const obj = { value: 1 }
    const s = deepFreeze(new Set([obj]))
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(obj)).toBe(true)
  })
})
