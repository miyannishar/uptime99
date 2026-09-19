import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/a-sequence.json')

describe('data/minigames/instances/a-sequence.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/a-sequence.json')
  })

  it('holds seven instances', () => {
    expect(instances).toHaveLength(7)
  })

  it('covers all six sequence difficulty-slots', () => {
    const slots = instances.map((i: any) => `${i.minigame}:${i.difficulty}`).sort()
    expect([...new Set(slots)]).toEqual([
      'cert_chain_puzzle:2', 'dns_cutover:2', 'dns_cutover:4',
      'restore_drill:2', 'restore_drill:3', 'restore_drill:5',
    ])
  })

  it('only holds minigames that use the ordered_sequence format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('ordered_sequence')
  })

  it('gives every instance a solution order that indexes into its given steps', () => {
    for (const i of instances) {
      const n = i.given.steps.length
      for (const idx of i.solution.order) {
        expect(idx, i.id).toBeGreaterThanOrEqual(0)
        expect(idx, i.id).toBeLessThan(n)
      }
      expect(new Set(i.solution.order).size, i.id).toBe(i.solution.order.length)
    }
  })

  it('leaves exactly decoy_steps steps out of the solution order', () => {
    for (const i of instances) {
      const unused = i.given.steps.length - i.solution.order.length
      expect(unused, i.id).toBe(i.levers.decoy_steps)
    }
  })

  it('matches step_count to the number of steps actually in the solution', () => {
    for (const i of instances) {
      expect(i.solution.order.length, i.id).toBe(i.levers.step_count)
    }
  })
})
