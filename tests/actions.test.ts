import { describe, it, expect } from 'vitest'
import { expectValidAgainst, allTagIds } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'
import { matchActions } from '../src/validate/matchActions'

type Action = { id: string; minigame: string; constraint: any; on_success: any; on_fail: any }
const { actions } = loadJson<{ actions: Action[] }>('data/actions.json')

describe('data/actions.json', () => {
  it('validates against the action schema', () => {
    expectValidAgainst('data/schema/action.schema.json', 'data/actions.json')
  })

  it('has unique action ids', () => {
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length)
  })

  it('only references tags that exist', () => {
    const known = allTagIds()
    const referenced = actions.flatMap((a) => [
      ...(a.constraint.tags_all ?? []),
      ...(a.constraint.tags_any ?? []),
      ...(a.constraint.tags_none ?? []),
      ...(a.on_success.tags_add ?? []),
      ...(a.on_success.tags_remove ?? []),
    ])
    expect(referenced.filter((t) => !known.has(t))).toEqual([])
  })

  it('gives every action a minigame and a failure consequence', () => {
    for (const a of actions) {
      expect(a.minigame, a.id).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(Object.keys(a.on_fail).length, a.id).toBeGreaterThan(0)
    }
  })
})

describe('matchActions', () => {
  const base = { layer: 'data', role: 'relational_store', node_id: 'postgres', tier: 1, health: 100, tags: ['stateful', 'spof', 'no_backup'] }

  it('offers add_replica to a stateful node without a replica', () => {
    expect(matchActions(base, actions)).toContain('add_replica')
  })

  it('withdraws add_replica once a replica exists', () => {
    const withReplica = { ...base, tags: ['stateful', 'has_replica'] }
    expect(matchActions(withReplica, actions)).not.toContain('add_replica')
  })

  it('offers restart only to an unhealthy node', () => {
    expect(matchActions({ ...base, health: 100 }, actions)).not.toContain('restart')
    expect(matchActions({ ...base, health: 40 }, actions)).toContain('restart')
  })

  it('honours actions_extra', () => {
    const result = matchActions({ ...base, node_id: 'redis', role: 'cache_store', actions_extra: ['flush_cache'] }, actions)
    expect(result).toContain('flush_cache')
  })

  it('lets actions_deny override a predicate match and actions_extra', () => {
    expect(matchActions({ ...base, actions_deny: ['add_replica'] }, actions)).not.toContain('add_replica')
    expect(matchActions({ ...base, actions_extra: ['add_replica'], actions_deny: ['add_replica'] }, actions))
      .not.toContain('add_replica')
  })

  it('returns ids sorted so output is stable', () => {
    const result = matchActions(base, actions)
    expect(result).toEqual([...result].sort())
  })
})
