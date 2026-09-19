import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/queue.json')
const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]))

describe('data/incidents/queue.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/queue.json')
  })

  it('defines the six queue incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'consumer_crash', 'consumer_lag_spike', 'dlq_overflow',
      'poison_message', 'queue_overflow', 'scheduler_drift',
    ])
  })

  it('produces the unbounded_queue tag from exactly two incidents', () => {
    const producers = incidents
      .filter((i: any) => (i.damage.tags_add ?? []).includes('unbounded_queue'))
      .map((i: any) => i.id).sort()
    expect(producers).toEqual(['consumer_crash', 'scheduler_drift'])
  })

  it('wires the full escalation chain', () => {
    expect(byId.consumer_crash.escalates_to).toBe('consumer_lag_spike')
    expect(byId.consumer_lag_spike.escalates_to).toBe('queue_overflow')
    expect(byId.queue_overflow.escalates_to).toBe('dlq_overflow')
    expect(byId.dlq_overflow.escalates_to).toBeNull()
  })

  it('gives every escalating incident a delay', () => {
    for (const i of incidents) {
      if (i.escalates_to) expect(i.escalate_after_ticks, i.id).toBeGreaterThan(0)
      else expect(i.escalate_after_ticks, i.id).toBeNull()
    }
  })

  it('makes the escalation-reachable incidents weak first movers', () => {
    for (const id of ['consumer_lag_spike', 'queue_overflow', 'dlq_overflow']) {
      expect(byId[id].base_weight, id).toBeLessThanOrEqual(3)
    }
  })

  it('targets the two hunters on the runtime tag their producers create', () => {
    expect(byId.consumer_lag_spike.target.tags_all).toContain('unbounded_queue')
    expect(byId.queue_overflow.target.tags_all).toContain('unbounded_queue')
  })
})
