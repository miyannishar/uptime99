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
