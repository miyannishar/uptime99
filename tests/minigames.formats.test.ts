import { describe, it, expect } from 'vitest'
import { expectValidAgainst } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { formats } = loadJson<any>('data/minigames/formats.json')
const byId = Object.fromEntries(formats.map((f: any) => [f.id, f]))

describe('data/minigames/formats.json', () => {
  it('validates against the format schema', () => {
    expectValidAgainst('data/schema/minigame-format.schema.json', 'data/minigames/formats.json')
  })

  it('defines exactly the five formats', () => {
    expect(formats.map((f: any) => f.id).sort()).toEqual(
      ['dial', 'evidence', 'fill_blank', 'ordered_sequence', 'wiring'],
    )
  })

  it('gives every format at least two difficulty levers', () => {
    for (const f of formats) {
      expect(Object.keys(f.levers).length, f.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('declares the dial levers the spec requires', () => {
    expect(Object.keys(byId.dial.levers).sort())
      .toEqual(['second_constraint', 'table_complete', 'tolerance_pct'])
  })

  it('declares the evidence levers the spec requires', () => {
    expect(Object.keys(byId.evidence.levers).sort())
      .toEqual(['distractor_count', 'distractor_plausibility', 'output_lines'])
  })

  it('bounds every numeric lever', () => {
    for (const f of formats) {
      for (const [name, spec] of Object.entries<any>(f.levers)) {
        if (spec.type === 'integer' || spec.type === 'number') {
          expect(spec.min, `${f.id}.${name}`).toBeTypeOf('number')
          expect(spec.max, `${f.id}.${name}`).toBeTypeOf('number')
        }
        if (spec.type === 'enum') {
          expect(Array.isArray(spec.values), `${f.id}.${name}`).toBe(true)
        }
      }
    }
  })

  it('gives every format a description that says what the player does', () => {
    for (const f of formats) {
      expect(f.description.length, f.id).toBeGreaterThanOrEqual(40)
    }
  })
})
