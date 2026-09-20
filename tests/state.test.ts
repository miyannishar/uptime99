import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'

const validate = compileSchema('data/schema/state.schema.json')
const base = loadJson<any>('tests/fixtures/valid-instance.json')
const clone = () => structuredClone(base)

describe('state.schema.json', () => {
  it('accepts a well-formed instance', () => {
    expect(validate(base).errors.join('\n')).toBe('')
  })

  it('rejects health outside 0..100', () => {
    const bad = clone()
    bad.instances[0].health = 120
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a missing def_id', () => {
    const bad = clone()
    delete bad.instances[0].def_id
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects balance fields leaking into instance state', () => {
    const bad = clone()
    bad.instances[0].cost_month = 50
    expect(validate(bad).valid).toBe(false)
  })

  it('allows utilization above 100 so saturation is representable', () => {
    const hot = clone()
    hot.instances[0].utilization_pct = 180
    expect(validate(hot).valid).toBe(true)
  })

  it('requires the down field', () => {
    const bad = clone()
    delete bad.instances[0].down
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts a node that is down but healthy', () => {
    const unreachable = clone()
    unreachable.instances[0].down = true
    unreachable.instances[0].health = 95
    expect(validate(unreachable).valid).toBe(true)
  })
})

describe('state.schema.json — game-level fields', () => {
  it('requires the new top-level fields', () => {
    for (const key of ['save_version', 'scenario_id', 'phase', 'tick', 'budget',
                       'rng_seed', 'carried', 'history',
                       'instances', 'incidents', 'ledger', 'session']) {
      const bad = clone()
      delete bad[key]
      expect(validate(bad).valid, `missing ${key} should fail`).toBe(false)
    }
  })

  it('rejects active_incidents on an instance now that incidents are game-level', () => {
    const bad = clone()
    bad.instances[0].active_incidents = ['oom_kill']
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts an architecture-scope incident with a null instance_id', () => {
    const s = clone()
    s.incidents.push({
      key: 'unencrypted_at_rest#1', incident_id: 'unencrypted_at_rest',
      instance_id: null, started_tick: 3,
      escalate_at_tick: null, expires_at_tick: null, attempts: {},
    })
    expect(validate(s).errors.join('\n')).toBe('')
  })

  it('rejects an unknown phase', () => {
    const bad = clone()
    bad.phase = 'paused'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a ledger cadence outside the enum', () => {
    const bad = clone()
    bad.ledger.push({ kind: 'sla_credit', basis: 1, cadence: 'weekly',
                      amount: -10, tick: 1, instance_id: null })
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a derived metric leaking into carried', () => {
    const bad = clone()
    bad.carried.p95_latency_ms = 412
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts a null rng_seed and an integer one, but not a float', () => {
    const s = clone()
    s.rng_seed = null
    expect(validate(s).errors.join('\n')).toBe('')
    s.rng_seed = 12345
    expect(validate(s).errors.join('\n')).toBe('')
    s.rng_seed = 1.5
    expect(validate(s).valid).toBe(false)
  })
})
