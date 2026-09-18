import { describe, it, expect } from 'vitest'
import { expectValidAgainst } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

type Metric = { id: string; kind: string; derived_from: string; formula: string; clamp: [number, number]; healthy_range: [number, number] }
const { metrics, economy } = loadJson<{ metrics: Metric[]; economy: Record<string, number> }>('data/metrics.json')

describe('data/metrics.json', () => {
  it('validates against the metric schema', () => {
    expectValidAgainst('data/schema/metric.schema.json', 'data/metrics.json')
  })

  it('defines the seven metrics', () => {
    expect(metrics.map((m) => m.id).sort()).toEqual(
      ['cost_month', 'error_rate_pct', 'p95_latency_ms', 'profit_month', 'reputation', 'uptime_pct', 'users'],
    )
  })

  it('splits four technical and three business metrics', () => {
    expect(metrics.filter((m) => m.kind === 'technical')).toHaveLength(4)
    expect(metrics.filter((m) => m.kind === 'business')).toHaveLength(3)
  })

  it('derives reputation from history, not the graph', () => {
    const rep = metrics.find((m) => m.id === 'reputation')!
    expect(rep.derived_from).toBe('history')
    expect(rep.kind).toBe('technical')
  })

  it('keeps healthy_range inside clamp for every metric', () => {
    for (const m of metrics) {
      expect(m.healthy_range[0], m.id).toBeGreaterThanOrEqual(m.clamp[0])
      expect(m.healthy_range[1], m.id).toBeLessThanOrEqual(m.clamp[1])
    }
  })

  it('only uses allowlisted functions in formulas', () => {
    const allowed = ['sum', 'min', 'max', 'clamp', 'saturation_curve', 'decay']
    for (const m of metrics) {
      const called = [...m.formula.matchAll(/([a-z_]+)\s*\(/g)].map((x) => x[1])
      expect(called.filter((f) => !allowed.includes(f)), m.id).toEqual([])
    }
  })

  it('defines the economy constants the cost engine needs', () => {
    for (const key of ['arpu', 'starting_budget', 'credit_rate', 'emergency_premium_multiplier',
                       'reputation_decay_per_tick', 'reputation_recovery_per_tick', 'tick_seconds',
                       'reputation_growth_rate', 'latency_churn_rate', 'outage_churn_rate',
                       'saturation_knee', 'saturation_exponent']) {
      expect(economy[key], key).toBeTypeOf('number')
    }
  })

  it('states utilisation as an explicit fraction of 100', () => {
    const p95 = metrics.find((m) => m.id === 'p95_latency_ms')!
    const err = metrics.find((m) => m.id === 'error_rate_pct')!
    expect(p95.formula).toContain('utilization_pct / 100')
    expect(err.formula).toContain('utilization_pct / 100')
    expect(p95.formula).not.toMatch(/\bpath\.util\b/)
    expect(err.formula).not.toMatch(/\bpath\.util\b/)
  })

  it('supplies a constant for every balance lever the users and latency formulas need', () => {
    // The users formula's reputation_growth / latency_churn / outage_churn terms are
    // derived per tick from these rates; saturation_curve is shaped by knee+exponent.
    expect(economy.reputation_growth_rate).toBe(0.03)
    expect(economy.latency_churn_rate).toBe(0.02)
    expect(economy.outage_churn_rate).toBe(0.08)
    expect(economy.saturation_knee).toBe(0.8)
    expect(economy.saturation_exponent).toBe(3.0)
    expect(economy.saturation_knee).toBeGreaterThan(0)
    expect(economy.saturation_knee).toBeLessThanOrEqual(1)
  })
})
