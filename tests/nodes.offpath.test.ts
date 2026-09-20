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

  it('provide only off-path capabilities (not request-path endpoints)', () => {
    // Request-path capabilities like 'origin', 'app_backend', 'sql_query' must not
    // appear in off-path provides — they would put the node on the latency path.
    const REQUEST_PATH_CAPS = new Set(['origin', 'app_backend', 'sql_query', 'cache', 'queue', 'blob_storage', 'search_query'])
    for (const n of [...reliability, ...delivery]) {
      for (const cap of n.provides) {
        expect(REQUEST_PATH_CAPS.has(cap), `${n.id} provides ${cap} — off-path nodes must not provide request-path capabilities`).toBe(false)
      }
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
