import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'
import { crossingTime } from '../src/engine/monitorCurve'

const { instances } = loadJson<any>('data/minigames/instances/i-monitor.json')

describe('data/minigames/instances/i-monitor.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/i-monitor.json')
  })

  it('holds three instances', () => {
    expect(instances).toHaveLength(3)
  })

  it('covers the live_monitor:3 difficulty-slot', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['live_monitor:3'])
  })

  it('only holds minigames that use the monitor format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('monitor')
  })

  it('each instance has metrics.length === levers.metric_count', () => {
    for (const i of instances) {
      expect(i.given.metrics.length, i.id).toBe(i.levers.metric_count)
    }
  })

  it('solution metric exists in given.metrics', () => {
    for (const i of instances) {
      const ids = i.given.metrics.map((m: any) => m.id)
      expect(ids, i.id).toContain(i.solution.metric)
    }
  })

  it('crossing time is non-null, >= 3 s, and crossing + window_s <= duration_s', () => {
    for (const i of instances) {
      const m = i.given.metrics.find((x: any) => x.id === i.solution.metric)
      const tStar = crossingTime(m, i.solution.threshold, i.solution.direction, i.given.duration_s)
      expect(tStar, `${i.id}: crossingTime must not be null`).not.toBeNull()
      expect(tStar!, `${i.id}: crossing must happen at >= 3 s`).toBeGreaterThanOrEqual(3)
      expect(tStar! + i.solution.window_s, `${i.id}: crossing + window must fit in duration_s`).toBeLessThanOrEqual(i.given.duration_s)
    }
  })

  it('wrong_outcomes include too_early, too_late, and wrong_metric', () => {
    for (const i of instances) {
      const whens = i.wrong_outcomes.map((w: any) => w.when)
      expect(whens, `${i.id}: must have too_early`).toContain('too_early')
      expect(whens, `${i.id}: must have too_late`).toContain('too_late')
      expect(whens, `${i.id}: must have wrong_metric`).toContain('wrong_metric')
    }
  })
})
