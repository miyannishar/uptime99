import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { nodes } = loadJson<any>('data/nodes/edge.json')

describe('data/nodes/edge.json', () => {
  it('is a valid node file', () => {
    expectValidNodeFile('data/nodes/edge.json')
  })

  it('defines the four edge nodes', () => {
    expect(nodes.map((n: any) => n.id).sort()).toEqual(['cdn', 'dns', 'tls_cert', 'waf'])
  })

  it('makes dns a singleton with blast radius 1 at tier 1', () => {
    const dns = nodes.find((n: any) => n.id === 'dns')
    expect(dns.singleton).toBe(true)
    expect(dns.max_instances).toBe(1)
    expect(dns.tiers[0].stats.blast_radius).toBe(1.0)
  })

  it('gives tls_cert no capacity', () => {
    const tls = nodes.find((n: any) => n.id === 'tls_cert')
    expect(tls.tiers.every((t: any) => t.stats.capacity_unit === 'none')).toBe(true)
    expect(tls.tiers.every((t: any) => t.stats.capacity === 0)).toBe(true)
  })
})
