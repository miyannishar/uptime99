import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from './loadJson'

const SCENARIO_DIR = 'data/scenarios'
const INCIDENT_DIR = 'data/incidents'

export function loadScenarios(): any[] {
  const dir = resolve(import.meta.dirname, '../..', SCENARIO_DIR)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json')).sort()
    .map((f) => loadJson<any>(`${SCENARIO_DIR}/${f}`))
}

/**
 * Load all incident ids from data/incidents/*.json directly.
 * loadCatalog() does not expose incidents, so this function gives
 * checkScenarioRefs a reliable incident id set independent of the catalog shape.
 */
function loadIncidentIds(): Set<string> {
  const dir = resolve(import.meta.dirname, '../..', INCIDENT_DIR)
  const ids = new Set<string>()
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const file = loadJson<any>(`${INCIDENT_DIR}/${f}`)
    for (const incident of file.incidents ?? []) {
      ids.add(incident.id)
    }
  }
  return ids
}

export function checkScenarioRefs(scenarios: any[], catalog: any): string[] {
  const problems: string[] = []
  const nodeIds = new Set(catalog.nodes.map((n: any) => n.id))
  const incidentIds = loadIncidentIds()
  const seen = new Set<string>()

  for (const s of scenarios) {
    if (seen.has(s.id)) problems.push(`duplicate scenario id '${s.id}'`)
    seen.add(s.id)
    for (const b of s.board) {
      if (!nodeIds.has(b.def_id)) {
        problems.push(`scenario '${s.id}': board references unknown node '${b.def_id}'`)
      }
    }
    for (const i of s.incidents) {
      if (!incidentIds.has(i.incident_id)) {
        problems.push(`scenario '${s.id}': unknown incident '${i.incident_id}'`)
      }
    }
    if (s.end.kind === 'fixed_window') {
      for (const i of s.incidents) {
        if (i.at_tick > s.end.ticks) {
          problems.push(
            `scenario '${s.id}': incident '${i.incident_id}' fires at tick ${i.at_tick}, ` +
            `after the window ends at ${s.end.ticks} — it would never appear`,
          )
        }
      }
    }
  }
  return problems
}

/**
 * Progression and mode coherence. Levels, standalone scenarios and free play
 * share one file shape, so these rules are what keep the three distinguishable:
 * a scripted scenario with no schedule would run empty, and a weighted one with
 * a schedule would have two competing sources of arrivals.
 */
export function checkScenarioProgression(scenarios: any[]): string[] {
  const problems: string[] = []
  const ids = new Set(scenarios.map((s) => s.id))

  for (const s of scenarios) {
    for (const req of s.unlocked_by ?? []) {
      if (req === s.id) {
        problems.push(`scenario '${s.id}': unlocked_by names itself, so it can never unlock`)
      } else if (!ids.has(req)) {
        problems.push(`scenario '${s.id}': unlocked_by names unknown scenario '${req}'`)
      }
    }
    if (s.incident_source === 'scripted' && (s.incidents ?? []).length === 0) {
      problems.push(
        `scenario '${s.id}': incident_source is 'scripted' but no incidents are authored — ` +
        `the session would run empty`,
      )
    }
    if (s.incident_source === 'weighted' && (s.incidents ?? []).length > 0) {
      problems.push(
        `scenario '${s.id}': incident_source is 'weighted' but ${s.incidents.length} incident(s) ` +
        `are authored — runtime selection and an authored schedule would compete`,
      )
    }
  }
  return problems
}

export function checkScenarioBoards(scenarios: any[], catalog: any): string[] {
  const problems: string[] = []
  const byId = Object.fromEntries(catalog.nodes.map((n: any) => [n.id, n]))

  for (const s of scenarios) {
    const allowed = new Set(s.allowed_layers)
    let monthly = 0
    const counts: Record<string, number> = {}

    for (const b of s.board) {
      const def = byId[b.def_id]
      if (!def) continue // reported by checkScenarioRefs

      const tier = def.tiers.find((t: any) => t.tier === b.tier)
      if (!tier) {
        problems.push(`scenario '${s.id}': node '${b.def_id}' has no tier ${b.tier}`)
        // Do not continue: layer-membership, singleton, and max-instances checks
        // are still applicable and independent of whether a tier def was found.
      }

      if (!allowed.has(def.layer)) {
        problems.push(
          `scenario '${s.id}': board places '${b.def_id}' in layer '${def.layer}', ` +
          `which is not in allowed_layers`,
        )
      }
      counts[b.def_id] = (counts[b.def_id] ?? 0) + 1
      if (def.singleton && counts[b.def_id] > 1) {
        problems.push(`scenario '${s.id}': '${b.def_id}' is a singleton but appears ${counts[b.def_id]} times`)
      }
      if (counts[b.def_id] > def.max_instances) {
        problems.push(
          `scenario '${s.id}': '${b.def_id}' appears ${counts[b.def_id]} times, ` +
          `exceeding max_instances ${def.max_instances}`,
        )
      }
      if (tier) monthly += tier.stats.cost_month
    }

    // Runway check: the board's total monthly cost vs. the scenario's starting
    // credit balance. These are different units — a recurring rate against a
    // one-time credit — so the message frames it as sustainability rather than
    // affordability. Whether budget is debited at provision time, monthly, or
    // both is undecided and belongs to the next plan; economy.starting_budget
    // is the default that a scenario's own starting_budget may override.
    if (monthly > s.starting_budget) {
      problems.push(
        `scenario '${s.id}': board costs $${monthly}/mo against $${s.starting_budget} ` +
        `starting credits — the scenario is unsustainable from the first month`,
      )
    }
  }
  return problems
}
