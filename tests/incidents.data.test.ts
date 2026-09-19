import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/data.json')
const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]))

describe('data/incidents/data.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/data.json')
  })

  it('defines the eight data incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'backup_corruption', 'cache_eviction_storm', 'cache_invalidation_storm',
      'data_loss_incident', 'redis_restart', 'replication_lag_spike',
      'schema_migration_failure', 'silent_failure',
    ])
  })

  it('produces the cold_cache tag from exactly two incidents', () => {
    const producers = incidents
      .filter((i: any) => (i.damage.tags_add ?? []).includes('cold_cache'))
      .map((i: any) => i.id).sort()
    expect(producers).toEqual(['cache_eviction_storm', 'redis_restart'])
  })

  it('makes running without backups the most dangerous state in the catalog', () => {
    expect(byId.data_loss_incident.severity).toBe(5)
    expect(byId.data_loss_incident.weight_per_target).toBe(7)
    expect(byId.data_loss_incident.target.tags_all).toContain('no_backup')
  })

  it('makes data loss unrecoverable — you cannot restore what you never backed up', () => {
    expect(byId.data_loss_incident.resolved_by).toEqual([])
    expect(byId.data_loss_incident.duration_ticks).toBe(40)
  })

  it('targets backup_corruption at the backup system so verify_restore is reachable', () => {
    expect(byId.backup_corruption.target.node_ids).toEqual(['backup_system'])
    expect(byId.backup_corruption.resolved_by).toEqual(['verify_restore'])
  })

  it('escalates a cache eviction storm into performance degradation', () => {
    expect(byId.cache_eviction_storm.escalates_to).toBe('performance_degradation')
    expect(byId.cache_eviction_storm.escalate_after_ticks).toBeGreaterThan(0)
  })

  it('does not mark a cache incident down — a cold cache is slow, not absent', () => {
    for (const id of ['cache_eviction_storm', 'cache_invalidation_storm', 'redis_restart']) {
      expect(byId[id].damage.down ?? false, id).toBe(false)
    }
  })

  it('gives every incident a level-0 signal', () => {
    for (const i of incidents) {
      expect(i.signals.find((s: any) => s.level === 0), i.id).toBeTruthy()
    }
  })
})
