import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const reliability = loadJson<any>('data/nodes/reliability.json').nodes
const delivery = loadJson<any>('data/nodes/delivery.json').nodes

describe('off-path node files', () => {
  it('are valid node files', () => {
    expectValidNodeFile('data/nodes/reliability.json')
    expectValidNodeFile('data/nodes/delivery.json')
  })

  it('define the expected nodes', () => {
    expect(reliability.map((n: any) => n.id).sort()).toEqual(['backup_system', 'dr_region'])
    expect(delivery.map((n: any) => n.id).sort()).toEqual(['ci_cd', 'feature_flags', 'secrets_manager'])
  })

  it('wire nothing into the request path', () => {
    for (const n of [...reliability, ...delivery]) {
      expect(n.provides, n.id).toEqual([])
      expect(n.requires, n.id).toEqual([])
      expect(n.overridable_edges, n.id).toBe(false)
      expect(n.singleton, n.id).toBe(true)
    }
  })

  it('gives off-path nodes zero blast radius and zero latency', () => {
    for (const n of [...reliability, ...delivery]) {
      for (const t of n.tiers) {
        expect(t.stats.blast_radius, `${n.id} t${t.tier}`).toBe(0)
        expect(t.stats.base_latency_ms, `${n.id} t${t.tier}`).toBe(0)
        expect(t.stats.capacity_unit, `${n.id} t${t.tier}`).toBe('none')
      }
    }
  })
})
