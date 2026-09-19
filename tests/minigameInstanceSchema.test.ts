import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'
import { expectValidInstanceFile } from './helpers/dataFiles'

const validate = compileSchema('data/schema/minigame-instance.schema.json')
const base = loadJson<any>('tests/fixtures/valid-instance-file.json')
const clone = () => structuredClone(base)

describe('minigame-instance.schema.json', () => {
  it('accepts a well-formed instance file', () => {
    expect(validate(base).errors.join('\n')).toBe('')
  })

  it('rejects a difficulty outside 1..5', () => {
    const bad = clone(); bad.instances[0].difficulty = 6
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a teaches string under 30 characters', () => {
    const bad = clone(); bad.instances[0].teaches = 'too short'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a reveal string under 40 characters', () => {
    const bad = clone(); bad.instances[0].reveal = 'short'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an empty wrong_outcomes array', () => {
    const bad = clone(); bad.instances[0].wrong_outcomes = []
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown wrong_outcomes when value', () => {
    const bad = clone(); bad.instances[0].wrong_outcomes[0].when = 'sideways'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an empty solution object', () => {
    const bad = clone(); bad.instances[0].solution = {}
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown top-level field', () => {
    const bad = clone(); bad.instances[0].score = 10
    expect(validate(bad).valid).toBe(false)
  })
})

describe('expectValidInstanceFile', () => {
  it('accepts the valid fixture', () => {
    expect(() => expectValidInstanceFile('tests/fixtures/valid-instance-file.json')).not.toThrow()
  })

  it('rejects a difficulty no action demands for that minigame', () => {
    expect(() => expectValidInstanceFile('tests/fixtures/invalid-instance-file.json'))
      .toThrow(/difficulty/)
  })
})
