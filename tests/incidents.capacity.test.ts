import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/capacity.json')

describe('data/incidents/capacity.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/capacity.json')
  })

  it('defines the eight capacity incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'alert_storm', 'ddos_attack', 'instance_size_cap', 'load_surge',
      'performance_degradation', 'scale_event_latency', 'traffic_spike',
      'vertical_limit_reached',
    ])
  })

  it('puts every incident in the capacity family', () => {
    expect(incidents.every((i: any) => i.family === 'capacity')).toBe(true)
  })

  it('makes alert_storm the only architecture-scope incident here', () => {
    const arch = incidents.filter((i: any) => i.scope === 'architecture').map((i: any) => i.id)
    expect(arch).toEqual(['alert_storm'])
    const i = incidents.find((x: any) => x.id === 'alert_storm')
    expect(i.target).toBeNull()
    expect(i.fires_when).toBeTruthy()
    expect(i.weight_per_target).toBe(0)
    expect(i.damage.health_delta).toBe(-5)
  })

  it('group-scopes load_surge so it can damage real instances', () => {
    const i = incidents.find((x: any) => x.id === 'load_surge')
    expect(i.scope).toBe('group')
    expect(i.group_by).toBe('layer')
    expect(i.target.tags_none).toContain('autoscaling')
    expect(i.damage.utilization_delta_pct).toBeGreaterThan(0)
  })

  it('makes every capacity incident raise utilisation', () => {
    const withUtil = incidents.filter((i: any) => (i.damage.utilization_delta_pct ?? 0) > 0)
    expect(withUtil.length).toBe(7)
  })

  it('targets traffic_spike by layer rather than by a request-path tag', () => {
    const i = incidents.find((x: any) => x.id === 'traffic_spike')
    expect(i.target.layers.sort()).toEqual(['compute', 'edge', 'ingress'])
    expect(JSON.stringify(i.target)).not.toContain('on_request_path')
  })

  it('gives every incident a level-0 signal', () => {
    for (const i of incidents) {
      expect(i.signals.find((s: any) => s.level === 0), i.id).toBeTruthy()
    }
  })
})
