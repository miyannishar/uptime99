import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/c-dial.json')

describe('data/minigames/instances/c-dial.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/c-dial.json')
  })

  it('holds nine instances', () => {
    expect(instances).toHaveLength(9)
  })

  it('covers all six dial difficulty-slots', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual([
      'capacity_planning:3', 'queue_triage:2', 'queue_triage:3',
      'resource_sizing:2', 'threshold_tuning:2', 'threshold_tuning:3',
    ])
  })

  it('only holds minigames that use the dial format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('dial')
  })

  it('gives EVERY dial instance both a below and an above wrong outcome', () => {
    for (const i of instances) {
      const whens = i.wrong_outcomes.map((w: any) => w.when).sort()
      expect(whens, i.id).toEqual(['above', 'below'])
    }
  })

  it('puts the solution value inside the dial range', () => {
    for (const i of instances) {
      expect(i.solution.value, i.id).toBeGreaterThanOrEqual(i.given.range.min)
      expect(i.solution.value, i.id).toBeLessThanOrEqual(i.given.range.max)
    }
  })

  it('gives every instance a table the player can reason from', () => {
    for (const i of instances) {
      expect(i.given.table.length, i.id).toBeGreaterThanOrEqual(3)
      expect(i.given.unit.length, i.id).toBeGreaterThan(0)
    }
  })

  it('gives threshold_tuning at least two instances, since six actions use it', () => {
    const n = instances.filter((i: any) => i.minigame === 'threshold_tuning').length
    expect(n).toBeGreaterThanOrEqual(2)
  })
})
