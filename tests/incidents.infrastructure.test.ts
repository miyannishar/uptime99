import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/infrastructure.json')

describe('data/incidents/infrastructure.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/infrastructure.json')
  })

  it('defines the ten infrastructure incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'az_outage', 'clock_skew', 'failover_jitter', 'hardware_failure', 'oom_kill',
      'primary_node_failure', 'process_restart', 'provider_outage', 'region_outage',
      'vendor_outage',
    ])
  })

  it('puts every incident in the infrastructure family', () => {
    expect(incidents.every((i: any) => i.family === 'infrastructure')).toBe(true)
  })

  it('makes the outages you cannot repair survive-only', () => {
    for (const id of ['provider_outage', 'vendor_outage', 'region_outage']) {
      const i = incidents.find((x: any) => x.id === id)
      expect(i.resolved_by, id).toEqual([])
      expect(i.duration_ticks, id).toBeGreaterThan(0)
    }
  })

  it('keeps az_outage resolvable by failing over', () => {
    const i = incidents.find((x: any) => x.id === 'az_outage')
    expect(i.resolved_by).toEqual(['failover', 'enable_multi_az'])
    expect(i.duration_ticks).toBeNull()
  })

  it('groups the zone and region outages by region', () => {
    for (const id of ['az_outage', 'region_outage']) {
      const i = incidents.find((x: any) => x.id === id)
      expect(i.scope, id).toBe('group')
      expect(i.group_by, id).toBe('region')
    }
  })

  it('gives every incident a level-0 signal that names no node or metric', () => {
    for (const i of incidents) {
      const l0 = i.signals.find((s: any) => s.level === 0)
      expect(l0, i.id).toBeTruthy()
      expect(l0.requires, i.id).toBeNull()
      expect(l0.text.length, i.id).toBeGreaterThan(20)
    }
  })

  it('marks nodes down only where the failure is a loss of reachability', () => {
    const down = incidents.filter((i: any) => i.damage.down === true).map((i: any) => i.id).sort()
    expect(down).toEqual(['az_outage', 'hardware_failure', 'primary_node_failure',
                          'provider_outage', 'region_outage'])
  })
})
