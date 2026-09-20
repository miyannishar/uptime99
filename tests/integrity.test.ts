import { describe, it, expect } from 'vitest'
import {
  runIntegrityChecks,
  loadCatalog,
  checkActionTagRefs,
  checkActionNodeAndRoleRefs,
  checkActionStatsDelta,
  checkActionReachability,
  checkActionMetricKeys,
  checkPortAcceptsDisjoint,
  matchableTiers,
} from '../src/validate/integrity'
import { loadJson } from '../src/validate/loadJson'

describe('runIntegrityChecks', () => {
  it('reports no problems for the shipped data', () => {
    expect(runIntegrityChecks()).toEqual([])
  })
})

describe('loadCatalog', () => {
  const catalog = loadCatalog()

  it('loads 27 nodes', () => {
    expect(catalog.nodes).toHaveLength(27)
  })

  it('has unique node ids across every file', () => {
    const ids = catalog.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(27)
  })

  it('places every node on a declared layer', () => {
    const layerIds = new Set(catalog.layers.map((l) => l.id))
    expect(catalog.nodes.filter((n) => !layerIds.has(n.layer))).toEqual([])
  })

  it('pairs every required capability with a provider', () => {
    const provided = new Set(catalog.nodes.flatMap((n) => n.provides))
    const accepted = catalog.nodes.flatMap((n) => n.requires.flatMap((r: any) => r.accepts))
    expect([...new Set(accepted)].filter((c) => !provided.has(c))).toEqual([])
  })

  it('offers at least one action beyond upgrading to every node tier', () => {
    const orphans: string[] = []
    for (const n of catalog.nodes) {
      for (const t of n.tiers) {
        const matched = catalog.actionsFor(n, t).filter((id) => id !== 'upgrade_tier')
        if (matched.length === 0) orphans.push(`${n.id}:t${t.tier}`)
      }
    }
    expect(orphans).toEqual([])
  })

  it('resolves every resolved_by action id in the tag registry', () => {
    const actionIds = new Set(catalog.actions.map((a) => a.id))
    const dangling = catalog.tags.flatMap((t) =>
      t.resolved_by.filter((a: string) => !actionIds.has(a)).map((a: string) => `${t.id} -> ${a}`),
    )
    expect(dangling).toEqual([])
  })

  it('rejects unknown metric keys in action on_success/on_fail deltas', () => {
    // Exercises the real check function, not a copy of its logic.
    const metricIds = new Set<string>(
      loadJson<any>('data/metrics.json').metrics.map((m: any) => m.id as string),
    )
    const badAction = {
      id: 'test_action',
      on_success: { metrics: { uptime_pct: '+5', bad_metric_key: '-2' } },
      on_fail: { metrics: { error_rate_pct: '+1', also_bogus: '+3' } },
    }
    expect(checkActionMetricKeys([badAction], metricIds)).toEqual([
      `action 'test_action' on_success: unknown metric key 'bad_metric_key'`,
      `action 'test_action' on_fail: unknown metric key 'also_bogus'`,
    ])
    // The shipped registry is clean.
    expect(checkActionMetricKeys(catalog.actions as any[], metricIds)).toEqual([])
  })
})

describe('action registry reference checks', () => {
  const catalog = loadCatalog()
  const knownTags = new Set<string>(catalog.tags.map((t: any) => t.id as string))
  const nodeIds = new Set<string>(catalog.nodes.map((n) => n.id))
  const roles = new Set<string>(catalog.nodes.map((n) => n.role))
  const runtimeOnlyTags = catalog.tags.filter((t: any) => t.runtime_only).map((t: any) => t.id as string)

  it('rejects unknown tag ids in all six action tag fields', () => {
    const badAction = {
      id: 'bad_tags',
      constraint: { tags_all: ['no_such_all'], tags_any: ['no_such_any'], tags_none: ['no_such_none'] },
      on_success: { tags_add: ['no_such_add'], tags_remove: ['no_such_remove'] },
      on_fail: { tags_add: ['no_such_fail_add'] },
    }
    expect(checkActionTagRefs([badAction], knownTags)).toEqual([
      `action 'bad_tags' constraint.tags_all: unknown tag 'no_such_all'`,
      `action 'bad_tags' constraint.tags_any: unknown tag 'no_such_any'`,
      `action 'bad_tags' constraint.tags_none: unknown tag 'no_such_none'`,
      `action 'bad_tags' on_success.tags_add: unknown tag 'no_such_add'`,
      `action 'bad_tags' on_success.tags_remove: unknown tag 'no_such_remove'`,
      `action 'bad_tags' on_fail.tags_add: unknown tag 'no_such_fail_add'`,
    ])
    // Real tag ids in every field are accepted, and the shipped registry is clean.
    const goodAction = {
      id: 'good_tags',
      constraint: { tags_all: ['stateful'], tags_none: ['spof'] },
      on_success: { tags_add: ['has_replica'], tags_remove: ['spof'] },
      on_fail: { tags_add: ['no_monitoring'] },
    }
    expect(checkActionTagRefs([goodAction], knownTags)).toEqual([])
    expect(checkActionTagRefs(catalog.actions as any[], knownTags)).toEqual([])
  })

  it('rejects unknown node ids and roles in action constraints', () => {
    const badAction = {
      id: 'bad_targets',
      constraint: { node_ids: ['postgres', 'postgress'], roles: ['relational_store', 'relational_stores'] },
    }
    expect(checkActionNodeAndRoleRefs([badAction], nodeIds, roles)).toEqual([
      `action 'bad_targets' constraint.node_ids: unknown node id 'postgress'`,
      `action 'bad_targets' constraint.roles: unknown role 'relational_stores'`,
    ])
    expect(checkActionNodeAndRoleRefs(catalog.actions as any[], nodeIds, roles)).toEqual([])
  })

  it('rejects stats_delta keys absent from a tier the action matches', () => {
    // The Fix 2 defect class: a percentage delta applied to a stat no tier declares.
    const badAction: any = {
      id: 'bad_stats',
      constraint: { node_ids: ['object_store'] },
      on_success: { stats_delta: { max_connections: '+100%' } },
    }
    const problems = checkActionStatsDelta([badAction], catalog.nodes, runtimeOnlyTags)
    expect(problems).toHaveLength(3)
    expect(problems[0]).toBe(
      `action 'bad_stats': on_success.stats_delta sets 'max_connections' but matching tier object_store tier 1 declares no such stat`,
    )
    // A stat every matched tier declares is accepted.
    const goodAction: any = {
      id: 'good_stats',
      constraint: { node_ids: ['postgres', 'redis', 'load_balancer', 'api_gateway'] },
      on_success: { stats_delta: { max_connections: '+100%' } },
    }
    expect(checkActionStatsDelta([goodAction], catalog.nodes, runtimeOnlyTags)).toEqual([])
    // The shipped registry is clean.
    expect(checkActionStatsDelta(catalog.actions, catalog.nodes, runtimeOnlyTags)).toEqual([])
  })

  it('rejects actions that can never match a tier', () => {
    // tags_any: [] is truthy but unsatisfiable — the case data/schema/action.schema.json
    // now forbids with minItems: 1.
    const empty: any = { id: 'never_matches', constraint: { tags_any: [] } }
    expect(checkActionReachability([empty], catalog.nodes, runtimeOnlyTags)).toEqual([
      `action 'never_matches': matches no tier in the catalog, so it is unreachable`,
    ])
    const ghost: any = { id: 'ghost', constraint: { node_ids: ['no_such_node'] } }
    expect(checkActionReachability([ghost], catalog.nodes, runtimeOnlyTags)).toEqual([
      `action 'ghost': matches no tier in the catalog, so it is unreachable`,
    ])
    // Every shipped action is reachable.
    expect(checkActionReachability(catalog.actions, catalog.nodes, runtimeOnlyTags)).toEqual([])
  })

  it('checkPortAcceptsDisjoint returns empty for the real 27-node catalogue', () => {
    expect(checkPortAcceptsDisjoint(catalog.nodes)).toEqual([])
  })

  it('checkPortAcceptsDisjoint fires on a synthetic node with overlapping port accepts', () => {
    const synthetic = [{
      id: 'test_overlap',
      requires: [
        { port: 'alpha', accepts: ['cap_x', 'cap_y'], min: 1, max: 2 },
        { port: 'beta',  accepts: ['cap_x', 'cap_z'], min: 0, max: 1 },
      ],
    }]
    const problems = checkPortAcceptsDisjoint(synthetic)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`node 'test_overlap'`)
    expect(problems[0]).toContain(`'alpha'`)
    expect(problems[0]).toContain(`'beta'`)
    expect(problems[0]).toContain(`'cap_x'`)
  })

  it('counts runtime-gated actions as reachable without special-casing their ids', () => {
    // restart is gated on max_health: 60 and warm_cache on the runtime-only
    // cold_cache tag, so neither matches at health 100 with definition tags alone.
    const byId = Object.fromEntries(catalog.actions.map((a) => [a.id, a]))
    for (const id of ['restart', 'warm_cache']) {
      expect(
        matchableTiers(byId[id], catalog.nodes, runtimeOnlyTags).length,
        `${id} should be reachable at runtime`,
      ).toBeGreaterThan(0)
    }
    // ...and they are genuinely absent from the definition-time match set.
    const anyTier = catalog.nodes.flatMap((n) => n.tiers.map((t: any) => catalog.actionsFor(n, t)))
    expect(anyTier.some((ids) => ids.includes('restart'))).toBe(false)
    expect(anyTier.some((ids) => ids.includes('warm_cache'))).toBe(false)
  })
})
