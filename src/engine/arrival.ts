import { nextFloat, type Rng } from './rng'
import { createLogger } from './logger'
import type { Difficulty } from './difficulty'
import type { EngineCatalog } from './catalogFrom'
import type { GameState, NodeInstance } from './types'

const log = createLogger('arrival')

/**
 * Instances an incident's `target` predicate matches. This is deliberately NOT
 * matchActions: that matches a predicate against a definition TIER, while an
 * incident targets a live instance, whose health and runtime tags matter.
 */
export function targetsOf(
  incident: any, state: GameState, catalog: EngineCatalog,
): NodeInstance[] {
  const t = incident.target
  if (!t) return []           // architecture scope targets no node
  return state.instances.filter((inst) => {
    const def = catalog.nodeById.get(inst.def_id)
    if (!def) return false
    const tier = def.tiers.find((x: any) => x.tier === inst.tier)
    const tags = new Set<string>([...(tier?.tags ?? []), ...inst.tags_runtime])
    if (t.layers && !t.layers.includes(def.layer)) return false
    if (t.roles && !t.roles.includes(def.role)) return false
    if (t.node_ids && !t.node_ids.includes(inst.def_id)) return false
    if (t.tags_all && !t.tags_all.every((g: string) => tags.has(g))) return false
    if (t.tags_any && !t.tags_any.some((g: string) => tags.has(g))) return false
    if (t.tags_none && t.tags_none.some((g: string) => tags.has(g))) return false
    if (t.min_tier !== undefined && inst.tier < t.min_tier) return false
    if (t.max_tier !== undefined && inst.tier > t.max_tier) return false
    if (t.min_health !== undefined && inst.health < t.min_health) return false
    if (t.max_health !== undefined && inst.health > t.max_health) return false
    return true
  })
}

/** Weakness-weighted eligibility: an incident with no targets weighs nothing. */
export function weightOf(incident: any, targets: readonly NodeInstance[]): number {
  if (targets.length === 0) return 0
  return incident.base_weight + incident.weight_per_target * targets.length
}

export function eligibleIncidents(
  state: GameState, catalog: EngineCatalog, difficulty: Difficulty,
): any[] {
  const active = new Set(state.incidents.map((r) => r.incident_id))
  return catalog.incidents.filter((inc: any) => {
    if (inc.severity > difficulty.severity_max) return false
    if (active.has(inc.id)) return false
    const g = inc.gates
    if (state.tick < g.min_tick) return false
    if (state.carried.users < g.min_users) return false
    const last = state.last_fired[inc.id]
    if (last !== undefined && state.tick - last < g.cooldown_ticks) return false
    // Architecture-scope incidents have target: null and are gated by a fires_when
    // posture predicate. Evaluating fires_when is out of scope for this plan
    // (recorded as a deferred gap). For now, treat them as eligible when severity
    // and gates pass — do not silently exclude them.
    if (inc.scope === 'architecture') return true
    return weightOf(inc, targetsOf(inc, state, catalog)) > 0
  })
}

/** Weighted draw among eligible incidents. Returns null when none are eligible. */
export function selectIncident(
  state: GameState, catalog: EngineCatalog, difficulty: Difficulty, rng: Rng,
): { incident: any | null; rng: Rng } {
  const pool = eligibleIncidents(state, catalog, difficulty)
  if (pool.length === 0) {
    log.debug('selectIncident: no eligible incidents', { tick: state.tick, difficulty: difficulty.arrival_mean_ticks })
    return { incident: null, rng }
  }

  const weights = pool.map((inc) =>
    inc.scope === 'architecture'
      ? inc.base_weight
      : weightOf(inc, targetsOf(inc, state, catalog)))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) {
    log.debug('selectIncident: zero total weight', { poolSize: pool.length })
    return { incident: null, rng }
  }

  const draw = nextFloat(rng)
  let acc = draw.value * total
  for (let i = 0; i < pool.length; i += 1) {
    acc -= weights[i]
    if (acc < 0) {
      log.debug('selectIncident selected', { incidentId: pool[i].id, severity: pool[i].severity, weight: weights[i] })
      return { incident: pool[i], rng: draw.rng }
    }
  }
  log.debug('selectIncident selected (last)', { incidentId: pool[pool.length - 1].id })
  return { incident: pool[pool.length - 1], rng: draw.rng }
}

/**
 * Whether an incident arrives this tick. A Bernoulli trial at 1/mean gives
 * geometrically distributed inter-arrival gaps, so arrivals feel irregular
 * rather than metronomic while averaging one per `arrival_mean_ticks`.
 */
export function shouldArrive(difficulty: Difficulty, rng: Rng): { arrive: boolean; rng: Rng } {
  const draw = nextFloat(rng)
  return { arrive: draw.value < 1 / difficulty.arrival_mean_ticks, rng: draw.rng }
}
