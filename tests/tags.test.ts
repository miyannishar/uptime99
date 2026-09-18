import { describe, it, expect } from 'vitest'
import { expectValidAgainst, allTagIds } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

type Tag = { id: string; label: string; kind: string; description: string; targeted_by: string[]; resolved_by: string[] }

describe('data/tags.json', () => {
  it('validates against the tag schema', () => {
    expectValidAgainst('data/schema/tag.schema.json', 'data/tags.json')
  })

  it('has unique tag ids', () => {
    const { tags } = loadJson<{ tags: Tag[] }>('data/tags.json')
    expect(new Set(tags.map((t) => t.id)).size).toBe(tags.length)
  })

  it('covers all four kinds', () => {
    const { tags } = loadJson<{ tags: Tag[] }>('data/tags.json')
    const kinds = new Set(tags.map((t) => t.kind))
    expect([...kinds].sort()).toEqual(['capability', 'posture', 'property', 'weakness'])
  })

  it('gives every weakness tag at least one resolving action', () => {
    const { tags } = loadJson<{ tags: Tag[] }>('data/tags.json')
    const unresolvable = tags.filter((t) => t.kind === 'weakness' && t.resolved_by.length === 0)
    expect(unresolvable.map((t) => t.id)).toEqual([])
  })

  it('exposes 47 tag ids', () => {
    expect(allTagIds().size).toBe(47)
  })

  it('has no unreachable posture tags', () => {
    const { tags } = loadJson<{ tags: { id: string }[] }>('data/tags.json')
    const ids = tags.map((t) => t.id)
    expect(ids).not.toContain('pci_scope')
    expect(ids).not.toContain('gdpr_scope')
  })

  it('treats runtime-only tags as produced by incidents, not hunted by them', () => {
    const { tags } = loadJson<{ tags: { id: string; targeted_by: string[] }[] }>('data/tags.json')
    const byId = Object.fromEntries(tags.map((t) => [t.id, t]))
    expect(byId.cold_cache.targeted_by.slice().sort())
      .toEqual(['cache_eviction_storm', 'redis_restart'])
    expect(byId.unbounded_queue.targeted_by.slice().sort())
      .toEqual(['consumer_crash', 'scheduler_drift'])
  })

  it('weakness tags carry the exact contracted resolved_by action ids', () => {
    const { tags } = loadJson<{ tags: Tag[] }>('data/tags.json')
    const byId = Object.fromEntries(tags.map((t) => [t.id, t.resolved_by.slice().sort()]))
    const expected: Record<string, string[]> = {
      spof:                    ['add_replica', 'enable_multi_az', 'scale_out'],
      no_backup:               ['enable_backup'],
      single_az:               ['enable_multi_az'],
      single_region:           ['enable_multi_region'],
      unencrypted:             ['enable_encryption'],
      public_exposed:          ['restrict_access'],
      no_ratelimit:            ['enable_rate_limit'],
      no_autoscale:            ['enable_autoscaling'],
      manual_failover:         ['enable_auto_failover'],
      no_monitoring:           ['enable_observability'],
      no_alerting:             ['enable_observability'],
      stale_cert:              ['renew_cert'],
      cold_cache:              ['warm_cache'],
      unbounded_queue:         ['drain_queue'],
      shared_credentials:      ['rotate_credentials'],
      no_rollback:             ['enable_rollback'],
      untested_restore:        ['verify_restore'],
      vertically_scalable_only: ['refactor_for_scale_out'],
      no_dlq:                  ['add_dlq'],
    }
    for (const [id, actions] of Object.entries(expected)) {
      expect(byId[id], `resolved_by for ${id}`).toEqual(actions)
    }
  })
})
