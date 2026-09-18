import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { nodes } = loadJson<any>('data/nodes/data.json')

describe('data/nodes/data.json', () => {
  it('is a valid node file', () => {
    expectValidNodeFile('data/nodes/data.json')
  })

  it('defines the five data-layer nodes', () => {
    expect(nodes.map((n: any) => n.id).sort()).toEqual(
      ['message_queue', 'object_store', 'postgres', 'redis', 'search_index'],
    )
  })

  it('puts every node on the data layer', () => {
    expect(nodes.every((n: any) => n.layer === 'data')).toBe(true)
  })

  it('gives postgres four tiers ending multi-region', () => {
    const pg = nodes.find((n: any) => n.id === 'postgres')
    expect(pg.tiers).toHaveLength(4)
    expect(pg.tiers[3].tags).toContain('multi_region')
  })

  it('starts every data node with a weakness tag on tier 1', () => {
    const weaknesses = new Set(
      loadJson<any>('data/tags.json').tags
        .filter((t: any) => t.kind === 'weakness')
        .map((t: any) => t.id),
    )
    for (const n of nodes) {
      const tier1 = n.tiers[0].tags.filter((t: string) => weaknesses.has(t))
      expect(tier1.length, `${n.id} tier 1 has no weakness to exploit`).toBeGreaterThan(0)
    }
  })

  it('raises capacity monotonically with tier', () => {
    for (const n of nodes) {
      const caps = n.tiers.map((t: any) => t.stats.capacity)
      expect(caps, n.id).toEqual([...caps].sort((a: number, b: number) => a - b))
    }
  })
})
