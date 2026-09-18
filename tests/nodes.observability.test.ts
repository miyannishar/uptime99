import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { nodes } = loadJson<any>('data/nodes/observability.json')

describe('data/nodes/observability.json', () => {
  it('is a valid node file', () => {
    expectValidNodeFile('data/nodes/observability.json')
  })

  it('defines the six observability nodes', () => {
    expect(nodes.map((n: any) => n.id).sort()).toEqual(
      ['alerting', 'log_pipeline', 'metrics_pipeline', 'oncall_rotation', 'status_page', 'tracing'],
    )
  })

  it('makes every observability node an off-path singleton', () => {
    for (const n of nodes) {
      expect(n.singleton, n.id).toBe(true)
      expect(n.provides, n.id).toEqual([])
      expect(n.requires, n.id).toEqual([])
      expect(n.tiers.every((t: any) => t.stats.blast_radius === 0), n.id).toBe(true)
    }
  })

  it('makes the top tier of every pipeline observable', () => {
    for (const id of ['metrics_pipeline', 'log_pipeline', 'tracing']) {
      const n = nodes.find((x: any) => x.id === id)
      expect(n.tiers.at(-1).tags, id).toContain('observable')
    }
  })

  it('reduces on-call fatigue as the rotation improves', () => {
    const oncall = nodes.find((n: any) => n.id === 'oncall_rotation')
    const rates = oncall.tiers.map((t: any) => t.stats.fatigue_rate)
    expect(rates).toEqual([...rates].sort((a: number, b: number) => b - a))
  })
})
