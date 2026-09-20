import { autoWire } from './ports'
import type { EngineCatalog } from './catalog'
import type { GameState, NodeInstance, ScenarioDef } from './types'

/**
 * The canonical instance-id rule. `src/engine/view.ts` regenerates ids to key
 * authored x/y positions, so this must have exactly one definition — if the two
 * sites ever disagree, every position lookup misses and the board silently
 * renders at the origin.
 */
export function instanceIdFor(defId: string, n: number): string {
  return `${defId.replace(/_/g, '-')}-${n}`
}

/** Parse already-fetched JSON into a typed ScenarioDef. No I/O. */
export function scenarioFrom(json: unknown): ScenarioDef {
  if (!json || typeof json !== 'object' || !('id' in json)) {
    throw new Error('scenario: invalid scenario JSON — missing id')
  }
  return json as ScenarioDef
}

/** Look up a scenario by id from the catalog. Throws if not found. */
export function scenarioById(scenarioId: string, catalog: EngineCatalog): ScenarioDef {
  const found = catalog.scenarioById.get(scenarioId)
  if (!found) throw new Error(`scenario: unknown id '${scenarioId}'`)
  return found as ScenarioDef
}

export function loadScenario(scenarioId: string, catalog: EngineCatalog): GameState {
  const scenario = scenarioById(scenarioId, catalog)
  const counts: Record<string, number> = {}

  const instances: NodeInstance[] = scenario.board.map((b) => {
    counts[b.def_id] = (counts[b.def_id] ?? 0) + 1
    return {
      instance_id: instanceIdFor(b.def_id, counts[b.def_id]),
      def_id: b.def_id,
      tier: b.tier,
      region: b.region,
      health: 100,
      utilization_pct: 0,
      down: false,
      tags_runtime: [],
      action_cooldowns: {},
      edges_out: [],
      provisioning_until_tick: null,
      created_tick: 0,
    }
  })

  return {
    save_version: 1,
    scenario_id: scenario.id,
    phase: 'design',
    tick: 0,
    budget: scenario.starting_budget,
    rng_seed: null,
    // 50,000 is the single authoritative starting user count. The `users` formula
    // reads its own previous value each tick, so it must be seeded here. If scenarios
    // ever need to vary it, add a `starting_users` field to the scenario schema and
    // read it here — there is no other place this value should live.
    carried: { reputation: 100, users: 50000 },
    history: {},
    instances: autoWire(instances, catalog),
    incidents: [],
    ledger: [],
    last_fired: {},
    session: {
      peak_p95_ms: 0, incidents_fired: 0, incidents_resolved: 0, status: 'running',
    },
  }
}
