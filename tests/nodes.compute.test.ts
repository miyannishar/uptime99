import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { nodes } = loadJson<any>('data/nodes/compute.json')

describe('data/nodes/compute.json', () => {
  it('is a valid node file', () => {
    expectValidNodeFile('data/nodes/compute.json')
  })

  it('defines the four compute nodes', () => {
    expect(nodes.map((n: any) => n.id).sort()).toEqual(
      ['app_cluster', 'cron_scheduler', 'serverless_fn', 'worker_pool'],
    )
  })

  it('lets the app cluster reach four tiers', () => {
    const app = nodes.find((n: any) => n.id === 'app_cluster')
    expect(app.tiers).toHaveLength(4)
    expect(app.max_instances).toBe(8)
  })

  it('makes the app cluster requirements optional so a bare app can boot', () => {
    const app = nodes.find((n: any) => n.id === 'app_cluster')
    expect(app.requires.every((r: any) => r.min === 0)).toBe(true)
  })

  it('tags async nodes so latency maths can skip them', () => {
    for (const id of ['worker_pool', 'cron_scheduler']) {
      const n = nodes.find((x: any) => x.id === id)
      const asyncOrScheduled = n.tiers.every(
        (t: any) => t.tags.includes('async') || t.tags.includes('scheduled'),
      )
      expect(asyncOrScheduled, id).toBe(true)
      expect(n.tiers.every((t: any) => t.stats.base_latency_ms === 0), id).toBe(true)
    }
  })

  it('requires a queue for the worker pool', () => {
    const w = nodes.find((n: any) => n.id === 'worker_pool')
    expect(w.requires[0].accepts).toContain('queue')
    expect(w.requires[0].min).toBe(1)
  })
})
