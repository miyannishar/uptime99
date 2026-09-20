import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from './loadJson'
import { compileSchema } from './schemaValidator'
import { matchActions, type Action, type Constraint } from './matchActions'
import {
  loadIncidents,
  checkIncidentCount,
  checkTagIncidentBidirectional,
  checkIncidentConstraintRefs,
  checkResolvedByMatchable,
  checkEscalationGraph,
  checkWeaknessCoverage,
} from './incidentChecks'
import {
  loadMinigameData,
  checkRegistryMatchesActions,
  checkFormatsResolve,
  checkSlotCoverage,
  checkInstanceRefs,
  checkInstanceIdsUnique,
  checkInstanceShapes,
  checkWhenLegality,
} from './minigameChecks'
import {
  loadScenarios,
  checkScenarioRefs,
  checkScenarioBoards,
  checkScenarioProgression,
} from './scenarioChecks'
import {
  loadLevels,
  checkLevelShape,
  checkLevelIncidentCoverage,
  checkScenarioLevelRefs,
} from './levelChecks'

const NODE_DIR = 'data/nodes'

export type Catalog = {
  nodes: any[]
  layers: any[]
  tags: any[]
  actions: Action[]
  actionsFor: (node: any, tier: any) => string[]
}

export function loadCatalog(): Catalog {
  const dir = resolve(import.meta.dirname, '../..', NODE_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  const nodes = files.flatMap((f) => loadJson<any>(`${NODE_DIR}/${f}`).nodes)
  const layers = loadJson<any>('data/layers.json').layers
  const tags = loadJson<any>('data/tags.json').tags
  const actions = loadJson<{ actions: Action[] }>('data/actions.json').actions

  const actionsFor = (node: any, tier: any) =>
    matchActions(
      {
        layer: node.layer,
        role: node.role,
        node_id: node.id,
        tier: tier.tier,
        health: 100,
        tags: tier.tags,
        actions_extra: tier.actions_extra,
        actions_deny: tier.actions_deny,
      },
      actions,
    )

  return { nodes, layers, tags, actions, actionsFor }
}

/**
 * Every tier an action could match if runtime state were favourable.
 *
 * `min_health`/`max_health` are dropped and runtime-only tags are treated as
 * satisfiable, because definitions describe a node at full health with no
 * incident applied. Without this, actions that exist precisely to be played
 * mid-incident (`restart` at `max_health: 60`, `warm_cache` requiring the
 * runtime-only `cold_cache`) would look unreachable and their `stats_delta`
 * would never be checked. Layer/role/node_id/tag/tier gates and each tier's
 * `actions_extra`/`actions_deny` are all still honoured.
 */
export function matchableTiers(
  action: Action,
  nodes: any[],
  runtimeOnlyTags: string[],
): { node: any; tier: any }[] {
  const { min_health, max_health, ...healthFree } = action.constraint as Constraint
  const probe: Action = { id: action.id, constraint: healthFree }
  const out: { node: any; tier: any }[] = []
  for (const node of nodes) {
    for (const tier of node.tiers) {
      const matched = matchActions(
        {
          layer: node.layer,
          role: node.role,
          node_id: node.id,
          tier: tier.tier,
          health: 100,
          tags: [...tier.tags, ...runtimeOnlyTags],
          actions_extra: tier.actions_extra,
          actions_deny: tier.actions_deny,
        },
        [probe],
      )
      if (matched.includes(action.id)) out.push({ node, tier })
    }
  }
  return out
}

/** 8. Every tag id referenced by an action must exist in data/tags.json. */
export function checkActionTagRefs(actions: any[], knownTags: Set<string>): string[] {
  const problems: string[] = []
  const fields: [string, (a: any) => string[] | undefined][] = [
    ['constraint.tags_all', (a) => a.constraint?.tags_all],
    ['constraint.tags_any', (a) => a.constraint?.tags_any],
    ['constraint.tags_none', (a) => a.constraint?.tags_none],
    ['on_success.tags_add', (a) => a.on_success?.tags_add],
    ['on_success.tags_remove', (a) => a.on_success?.tags_remove],
    ['on_fail.tags_add', (a) => a.on_fail?.tags_add],
  ]
  for (const action of actions) {
    for (const [label, get] of fields) {
      for (const tag of get(action) ?? []) {
        if (!knownTags.has(tag)) {
          problems.push(`action '${action.id}' ${label}: unknown tag '${tag}'`)
        }
      }
    }
  }
  return problems
}

/** 9. constraint.node_ids and constraint.roles must name real nodes/roles. */
export function checkActionNodeAndRoleRefs(
  actions: any[],
  nodeIds: Set<string>,
  roles: Set<string>,
): string[] {
  const problems: string[] = []
  for (const action of actions) {
    for (const id of action.constraint?.node_ids ?? []) {
      if (!nodeIds.has(id)) {
        problems.push(`action '${action.id}' constraint.node_ids: unknown node id '${id}'`)
      }
    }
    for (const role of action.constraint?.roles ?? []) {
      if (!roles.has(role)) {
        problems.push(`action '${action.id}' constraint.roles: unknown role '${role}'`)
      }
    }
  }
  return problems
}

/**
 * 10. Every on_success.stats_delta key must exist in `stats` on every tier the
 * action can match, otherwise the action applies a delta to an undefined stat.
 */
export function checkActionStatsDelta(
  actions: Action[],
  nodes: any[],
  runtimeOnlyTags: string[],
): string[] {
  const problems: string[] = []
  for (const action of actions as any[]) {
    const statsDelta = action.on_success?.stats_delta
    if (!statsDelta) continue
    for (const { node, tier } of matchableTiers(action, nodes, runtimeOnlyTags)) {
      for (const key of Object.keys(statsDelta)) {
        if (!(key in tier.stats)) {
          problems.push(
            `action '${action.id}': on_success.stats_delta sets '${key}' but matching tier ${node.id} tier ${tier.tier} declares no such stat`,
          )
        }
      }
    }
  }
  return problems
}

/**
 * No node's `requires` ports may accept the same capability as another of its
 * own ports. src/engine/ports.ts counts a port's fill by re-testing `accepts`
 * against the consumer's edges, so overlapping ports would share edges and a
 * port could report more fills than its own `max` allows.
 */
export function checkPortAcceptsDisjoint(nodes: any[]): string[] {
  const problems: string[] = []
  for (const node of nodes) {
    const ports: any[] = node.requires ?? []
    for (let i = 0; i < ports.length; i += 1) {
      for (let j = i + 1; j < ports.length; j += 1) {
        const shared = (ports[i].accepts ?? []).filter((c: string) =>
          (ports[j].accepts ?? []).includes(c))
        if (shared.length > 0) {
          problems.push(
            `node '${node.id}': ports '${ports[i].port}' and '${ports[j].port}' both accept ` +
            `${shared.map((s: string) => `'${s}'`).join(', ')} — engine port-fill counting requires ` +
            `a node's ports to accept disjoint capability sets`,
          )
        }
      }
    }
  }
  return problems
}

/** 11. Every action must match at least one tier, or it is dead content. */
export function checkActionReachability(
  actions: Action[],
  nodes: any[],
  runtimeOnlyTags: string[],
): string[] {
  const problems: string[] = []
  for (const action of actions) {
    if (matchableTiers(action, nodes, runtimeOnlyTags).length === 0) {
      problems.push(`action '${action.id}': matches no tier in the catalog, so it is unreachable`)
    }
  }
  return problems
}

/** 7. Action metric keys must match known metric ids. */
export function checkActionMetricKeys(actions: any[], metricIds: Set<string>): string[] {
  const problems: string[] = []
  for (const action of actions) {
    for (const phase of ['on_success', 'on_fail'] as const) {
      if (action[phase]) {
        for (const key of Object.keys(action[phase].metrics ?? {})) {
          if (!metricIds.has(key)) {
            problems.push(`action '${action.id}' ${phase}: unknown metric key '${key}'`)
          }
        }
      }
    }
  }
  return problems
}

export function runIntegrityChecks(): string[] {
  const problems: string[] = []
  const c = loadCatalog()

  // 1. Schema validation for non-node files
  const schemaFor: Record<string, string> = {
    'data/tags.json': 'data/schema/tag.schema.json',
    'data/layers.json': 'data/schema/layer.schema.json',
    'data/actions.json': 'data/schema/action.schema.json',
    'data/metrics.json': 'data/schema/metric.schema.json',
  }
  for (const [dataPath, schemaPath] of Object.entries(schemaFor)) {
    const r = compileSchema(schemaPath)(loadJson(dataPath))
    if (!r.valid) problems.push(`${dataPath}: ${r.errors.join('; ')}`)
  }

  // 2. Schema validation for every node file
  const nodeSchema = compileSchema('data/schema/node.schema.json')
  const dir = resolve(import.meta.dirname, '../..', NODE_DIR)
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const r = nodeSchema(loadJson(`${NODE_DIR}/${f}`))
    if (!r.valid) problems.push(`${NODE_DIR}/${f}: ${r.errors.join('; ')}`)
  }

  // 3. Node count
  if (c.nodes.length !== 27) problems.push(`expected 27 nodes, found ${c.nodes.length}`)

  // 4. Unique node ids
  const seen = new Set<string>()
  for (const n of c.nodes) {
    if (seen.has(n.id)) problems.push(`duplicate node id '${n.id}'`)
    seen.add(n.id)
  }

  const knownTags = new Set<string>(c.tags.map((t: any) => t.id as string))
  const runtimeOnly = new Set<string>(c.tags.filter((t: any) => t.runtime_only).map((t: any) => t.id as string))
  const layerIds = new Set(c.layers.map((l: any) => l.id))
  const provided = new Set(c.nodes.flatMap((n) => n.provides))
  const actionIds = new Set(c.actions.map((a) => a.id))

  // 5. Per-node checks
  for (const n of c.nodes) {
    // Layer membership
    if (!layerIds.has(n.layer)) problems.push(`${n.id}: unknown layer '${n.layer}'`)
    // Singleton constraint
    if (n.singleton && n.max_instances !== 1) problems.push(`${n.id}: singleton with max_instances ${n.max_instances}`)
    // Capability requirements
    for (const r of n.requires) {
      for (const cap of r.accepts) {
        if (!provided.has(cap)) problems.push(`${n.id}: requires '${cap}' which nothing provides`)
      }
    }
    // Per-tier checks
    n.tiers.forEach((t: any, i: number) => {
      // Tier numbers are contiguous from 1
      if (t.tier !== i + 1) problems.push(`${n.id}: tier numbers not contiguous from 1`)
      // cost_month strictly increases
      if (i > 0 && t.stats.cost_month <= n.tiers[i - 1].stats.cost_month) {
        problems.push(`${n.id} tier ${t.tier}: cost_month must strictly increase`)
      }
      // Tags must be known and not runtime_only
      for (const tag of t.tags) {
        if (!knownTags.has(tag)) problems.push(`${n.id} tier ${t.tier}: unknown tag '${tag}'`)
        if (runtimeOnly.has(tag)) problems.push(`${n.id} tier ${t.tier}: runtime_only tag '${tag}' in a definition`)
      }
      // actions_extra and actions_deny must reference known action ids
      for (const id of [...(t.actions_extra ?? []), ...(t.actions_deny ?? [])]) {
        if (!actionIds.has(id)) problems.push(`${n.id} tier ${t.tier}: unknown action id '${id}'`)
      }
      // At least one action other than upgrade_tier must match
      if (c.actionsFor(n, t).filter((id) => id !== 'upgrade_tier').length === 0) {
        problems.push(`${n.id} tier ${t.tier}: no action beyond upgrade_tier matches, so the player cannot act on it during an incident`)
      }
    })
  }

  // 5b. Port accepts must be disjoint within a node
  problems.push(...checkPortAcceptsDisjoint(c.nodes))

  // 6. Tag resolved_by references must exist in actions
  for (const t of c.tags) {
    for (const a of t.resolved_by) {
      if (!actionIds.has(a)) problems.push(`tag '${t.id}': resolved_by references unknown action '${a}'`)
    }
  }

  // 7. Action metric keys must match known metric ids
  const metricIds = new Set<string>(loadJson<any>('data/metrics.json').metrics.map((m: any) => m.id as string))
  problems.push(...checkActionMetricKeys(c.actions as any[], metricIds))

  // 8-11. Action registry reference and applicability checks
  const nodeIds = new Set<string>(c.nodes.map((n) => n.id))
  const roles = new Set<string>(c.nodes.map((n) => n.role))
  const runtimeOnlyTags = [...runtimeOnly]
  problems.push(...checkActionTagRefs(c.actions as any[], knownTags))
  problems.push(...checkActionNodeAndRoleRefs(c.actions as any[], nodeIds, roles))
  problems.push(...checkActionStatsDelta(c.actions, c.nodes, runtimeOnlyTags))
  problems.push(...checkActionReachability(c.actions, c.nodes, runtimeOnlyTags))

  // 12–17. Incident integrity checks
  const incidents = loadIncidents()
  const tagList = loadJson<any>('data/tags.json').tags
  const incidentSchema = compileSchema('data/schema/incident.schema.json')
  for (const f of readdirSync(resolve(import.meta.dirname, '../..', 'data/incidents'))
                    .filter((x) => x.endsWith('.json'))) {
    const r = incidentSchema(loadJson(`data/incidents/${f}`))
    if (!r.valid) problems.push(`data/incidents/${f}: ${r.errors.join('; ')}`)
  }
  problems.push(...checkIncidentCount(incidents))
  problems.push(...checkTagIncidentBidirectional(incidents, tagList))
  problems.push(...checkIncidentConstraintRefs(incidents, c))
  problems.push(...checkResolvedByMatchable(incidents, c))
  problems.push(...checkEscalationGraph(incidents))
  problems.push(...checkWeaknessCoverage(incidents, tagList, c.actions))

  // 18–24. Minigame integrity checks
  const actionList = loadJson<any>('data/actions.json').actions
  for (const [dataPath, schemaPath] of [
    ['data/minigames/formats.json', 'data/schema/minigame-format.schema.json'],
    ['data/minigames/registry.json', 'data/schema/minigame-registry.schema.json'],
  ] as const) {
    const r = compileSchema(schemaPath)(loadJson(dataPath))
    if (!r.valid) problems.push(`${dataPath}: ${r.errors.join('; ')}`)
  }
  // schema-validate the instance files BEFORE loading them into one pool: a file
  // missing its top-level `instances` key would otherwise put `undefined` in the
  // pool and make the checks below throw a raw TypeError, hiding the real error
  // that was just recorded here
  const schemaProblemsBefore = problems.length
  const instSchema = compileSchema('data/schema/minigame-instance.schema.json')
  for (const f of readdirSync(resolve(import.meta.dirname, '../..', 'data/minigames/instances'))
                  .filter((x) => x.endsWith('.json'))) {
    const r = instSchema(loadJson(`data/minigames/instances/${f}`))
    if (!r.valid) problems.push(`data/minigames/instances/${f}: ${r.errors.join('; ')}`)
  }
  if (problems.length === schemaProblemsBefore) {
    const mgData = loadMinigameData()
    problems.push(...checkRegistryMatchesActions(mgData.minigames, actionList))
    problems.push(...checkFormatsResolve(mgData.minigames, mgData.formats))
    problems.push(...checkSlotCoverage(mgData.instances, actionList))
    problems.push(...checkInstanceRefs(mgData.instances, mgData.minigames, mgData.formats))
    problems.push(...checkInstanceIdsUnique(mgData.instances))
    problems.push(...checkInstanceShapes(mgData.instances, mgData.minigames))
    problems.push(...checkWhenLegality(mgData.instances, mgData.minigames))
  }

  // 25–28. Scenario integrity checks
  const scenarioSchema = compileSchema('data/schema/scenario.schema.json')
  const scenarios = loadScenarios()
  for (const s of scenarios) {
    const r = scenarioSchema(s)
    if (!r.valid) problems.push(`data/scenarios/${s.id}.json: ${r.errors.join('; ')}`)
  }
  problems.push(...checkScenarioRefs(scenarios, c))
  problems.push(...checkScenarioBoards(scenarios, c))
  problems.push(...checkScenarioProgression(scenarios))

  // 29–32. Level integrity checks
  const levelSchema = compileSchema('data/schema/level.schema.json')
  const levelsRaw = loadJson('data/levels.json')
  const lr = levelSchema(levelsRaw)
  if (!lr.valid) problems.push(`data/levels.json: ${lr.errors.join('; ')}`)
  const levels = loadLevels()
  problems.push(...checkLevelShape(levels))
  problems.push(...checkLevelIncidentCoverage(levels, loadIncidents()))
  problems.push(...checkScenarioLevelRefs(loadScenarios(), levels))

  return problems
}
