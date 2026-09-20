import { nextInt, type Rng } from './rng'
import { targetsOf } from './arrival'
import type { EngineCatalog } from './catalog'
import type { GameState, NodeInstance } from './types'

/**
 * Who an incident hits.
 *  instance      — one of the matching targets, drawn with the seeded rng
 *  group         — every matching target sharing one group_by value
 *  architecture  — nobody. Its health_delta is a schema artefact (the schema
 *                  requires a non-empty damage block) and applying it to a node
 *                  would be a bug, not a rounding of intent.
 */
export function affectedInstanceIds(
  incident: any, state: GameState, catalog: EngineCatalog, rng: Rng,
): { ids: string[]; rng: Rng } {
  if (incident.scope === 'architecture') return { ids: [], rng }

  const targets = targetsOf(incident, state, catalog)
  if (targets.length === 0) return { ids: [], rng }

  if (incident.scope === 'instance') {
    const draw = nextInt(rng, targets.length)
    return { ids: [targets[draw.value].instance_id], rng: draw.rng }
  }

  // group scope
  const keyOf = (inst: NodeInstance): string => {
    switch (incident.group_by) {
      case 'region': return inst.region
      case 'def_id': return inst.def_id
      case 'layer': return catalog.nodeById.get(inst.def_id)?.layer ?? 'unknown'
      default:
        throw new Error(
          `damage: incident '${incident.id}' has group scope but group_by ` +
          `'${incident.group_by}' is not one of region, layer, def_id`,
        )
    }
  }
  const groups = [...new Set(targets.map(keyOf))].sort()
  const draw = nextInt(rng, groups.length)
  const chosen = groups[draw.value]
  return { ids: targets.filter((t) => keyOf(t) === chosen).map((t) => t.instance_id), rng: draw.rng }
}

/** Apply an incident's damage to the named instances. Returns new state. */
export function applyDamage(
  state: GameState, incident: any, instanceIds: readonly string[],
): GameState {
  if (instanceIds.length === 0) return state
  const hit = new Set(instanceIds)
  const d = incident.damage

  return {
    ...state,
    instances: state.instances.map((inst) => {
      if (!hit.has(inst.instance_id)) return inst
      const health = d.health_delta === undefined
        ? inst.health
        : Math.min(100, Math.max(0, inst.health + d.health_delta))
      // no upper clamp: utilisation above 100 is what drives error_rate_pct
      const utilization_pct = d.utilization_delta_pct === undefined
        ? inst.utilization_pct
        : Math.max(0, inst.utilization_pct + d.utilization_delta_pct)
      const added: string[] = (d.tags_add ?? [])
        .filter((t: string) => !inst.tags_runtime.includes(t))
      return {
        ...inst,
        health,
        utilization_pct,
        down: d.down === true ? true : inst.down,
        tags_runtime: added.length ? [...inst.tags_runtime, ...added] : inst.tags_runtime,
      }
    }),
  }
}
