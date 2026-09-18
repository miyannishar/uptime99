import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'
import { expectValidNodeFile } from './helpers/dataFiles'

const validate = compileSchema('data/schema/node.schema.json')
const base = loadJson<any>('tests/fixtures/valid-node-file.json')
const clone = () => structuredClone(base)

describe('node.schema.json', () => {
  it('accepts a well-formed node file', () => {
    const result = validate(base)
    expect(result.errors.join('\n')).toBe('')
  })

  it('rejects a tier missing a universal stat', () => {
    const bad = clone()
    delete bad.nodes[0].tiers[0].stats.blast_radius
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown domain stat name', () => {
    const bad = clone()
    bad.nodes[0].tiers[0].stats.cpu_cores_typo = 4
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown cost_variable rate name', () => {
    const bad = clone()
    bad.nodes[0].tiers[0].cost_variable = { per_banana: 1 }
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects blast_radius outside 0..1', () => {
    const bad = clone()
    bad.nodes[0].tiers[0].stats.blast_radius = 1.5
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown capacity_unit', () => {
    const bad = clone()
    bad.nodes[0].tiers[0].stats.capacity_unit = 'bananas_sec'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a runtime field on a definition', () => {
    const bad = clone()
    bad.nodes[0].health = 80
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown layer', () => {
    const bad = clone()
    bad.nodes[0].layer = 'quantum'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects fewer than 3 tiers', () => {
    const bad = clone()
    bad.nodes[0].tiers = [bad.nodes[0].tiers[0]]
    expect(validate(bad).valid).toBe(false)
  })
})

describe('expectValidNodeFile', () => {
  it('accepts the valid fixture', () => {
    expect(() => expectValidNodeFile('tests/fixtures/valid-node-file.json')).not.toThrow()
  })

  it('rejects a file where cost_month does not strictly increase', () => {
    expect(() => expectValidNodeFile('tests/fixtures/invalid-node-file.json')).toThrow(/cost_month/)
  })
})
