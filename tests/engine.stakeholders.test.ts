import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { startRun } from '../src/engine/session'
import { applyStakeholderResponse, dueStakeholderMessages, ignoredResponse } from '../src/engine/stakeholders'
import type { GameState } from '../src/engine/types'

const c = loadEngineCatalog()
const base = startRun(loadScenario('free-play', c), c)
const withMetric = (s: GameState, id: string, v: number): GameState =>
  ({ ...s, history: { ...s.history, [id]: [...((s.history as any)[id] ?? []), v] } }) as GameState

describe('stakeholder catalogue', () => {
  it('loads six deep-frozen messages, indexed by id', () => {
    expect(c.stakeholders).toHaveLength(6)
    expect(Object.isFrozen(c.stakeholders[0])).toBe(true)
    expect(c.stakeholderById.get('cto_latency')).toBe(c.stakeholders[0])
  })
})

describe('dueStakeholderMessages', () => {
  it('fires a metric trigger once its threshold is crossed', () => {
    expect(dueStakeholderMessages(withMetric(base, 'p95_latency_ms', 120), c, {}).map((d) => d.id)).not.toContain('cto_latency')
    expect(dueStakeholderMessages(withMetric(base, 'p95_latency_ms', 340), c, {}).map((d) => d.id)).toContain('cto_latency')
  })

  it('respects the cooldown since the message was last shown', () => {
    const s = { ...withMetric(base, 'p95_latency_ms', 340), tick: 50 } as GameState
    expect(dueStakeholderMessages(s, c, { cto_latency: 10 }).map((d) => d.id)).not.toContain('cto_latency')
    expect(dueStakeholderMessages({ ...s, tick: 200 } as GameState, c, { cto_latency: 10 }).map((d) => d.id)).toContain('cto_latency')
  })

  it('fires an incident-severity trigger while such an incident is active', () => {
    const sev3 = [...c.incidentById.values()].find((i: any) => i.severity >= 3) as any
    const s = { ...base, incidents: [{ ...(base.incidents[0] ?? {}), key: 'k', incident_id: sev3.id, instance_id: null } as any] } as GameState
    expect(dueStakeholderMessages(s, c, {}).map((d) => d.id)).toContain('customer_major_incident')
    expect(dueStakeholderMessages({ ...s, incidents: [] } as GameState, c, {}).map((d) => d.id)).not.toContain('customer_major_incident')
  })
})

describe('applyStakeholderResponse', () => {
  it('clamps reputation to 0–100 and moves budget', () => {
    const hi = applyStakeholderResponse({ ...base, carried: { ...base.carried, reputation: 99 } } as GameState, { reputation_delta: 5, budget_delta: -150 })
    expect(hi.carried.reputation).toBe(100)
    expect(hi.budget).toBe(base.budget - 150)
    const lo = applyStakeholderResponse({ ...base, carried: { ...base.carried, reputation: 3 } } as GameState, { reputation_delta: -8, budget_delta: 0 })
    expect(lo.carried.reputation).toBe(0)
  })

  it('does not mutate the input state', () => {
    const before = base.carried.reputation
    applyStakeholderResponse(base, { reputation_delta: -5, budget_delta: -10 })
    expect(base.carried.reputation).toBe(before)
  })

  it('an ignored message costs the worst reputation response', () => {
    expect(ignoredResponse(c.stakeholderById.get('customer_major_incident')).reputation_delta).toBe(-8)
  })
})
