import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/delivery.json')
const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]))

describe('data/incidents/delivery.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/delivery.json')
  })

  it('defines the four delivery incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'api_deprecation', 'bad_deploy', 'canary_anomaly', 'disaster_recovery_drill',
    ])
  })

  it('hunts deploys that cannot be undone, and leaves only a restart', () => {
    expect(byId.bad_deploy.target.tags_none).toContain('has_rollback')
    expect(byId.bad_deploy.resolved_by).toEqual(['restart'])
  })

  it('makes the drill survive-only', () => {
    expect(byId.disaster_recovery_drill.resolved_by).toEqual([])
    expect(byId.disaster_recovery_drill.duration_ticks).toBeGreaterThan(0)
    expect(byId.disaster_recovery_drill.scope).toBe('architecture')
  })

  it('charges the drill on expiry rather than on resolution', () => {
    const kinds = byId.disaster_recovery_drill.ledger_events.map((e: any) => e.when)
    expect(kinds).toContain('on_expire')
  })

  it('escalates a bad deploy into a silent failure', () => {
    expect(byId.bad_deploy.escalates_to).toBe('silent_failure')
  })

  it('gives every incident a level-0 signal', () => {
    for (const i of incidents) {
      expect(i.signals.find((s: any) => s.level === 0), i.id).toBeTruthy()
    }
  })
})
