import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/d-wiring.json')

describe('data/minigames/instances/d-wiring.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/d-wiring.json')
  })

  it('holds two instances covering both topology slots', () => {
    expect(instances).toHaveLength(2)
    expect(instances.map((i: any) => i.difficulty).sort()).toEqual([3, 5])
    for (const i of instances) expect(i.minigame).toBe('topology_puzzle')
  })

  it('places the new component in a zone that is offered', () => {
    for (const i of instances) {
      expect(i.given.zones, i.id).toContain(i.solution.zone)
    }
  })

  it('connects only to nodes that exist in the diagram', () => {
    for (const i of instances) {
      const ids = new Set(i.given.nodes.map((n: any) => n.id))
      for (const t of i.solution.connect_to) expect(ids.has(t), `${i.id} -> ${t}`).toBe(true)
    }
  })

  it('solves into a different failure domain than the existing nodes', () => {
    for (const i of instances) {
      const existing = new Set(i.given.nodes.map((n: any) => n.zone))
      expect(existing.has(i.solution.zone), i.id).toBe(false)
    }
  })
})
