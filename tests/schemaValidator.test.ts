import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'

describe('loadJson', () => {
  it('throws a message naming the file when JSON is malformed', () => {
    expect(() => loadJson('tests/fixtures/broken.json')).toThrow(/broken\.json/)
  })
})

describe('compileSchema', () => {
  it('reports valid payloads as valid', () => {
    const validate = compileSchema('tests/fixtures/tiny.schema.json')
    expect(validate({ id: 'ok' })).toEqual({ valid: true, errors: [] })
  })

  it('reports the path and reason for an invalid payload', () => {
    const validate = compileSchema('tests/fixtures/tiny.schema.json')
    const result = validate({})
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/required property 'id'/)
  })

  it('rejects unknown properties', () => {
    const validate = compileSchema('tests/fixtures/tiny.schema.json')
    const result = validate({ id: 'ok', surprise: 1 })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/surprise/)
  })
})
