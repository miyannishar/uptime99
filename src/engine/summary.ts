/* Design-phase and debrief summaries: snapshots the player sees at the end of
   design and after a run completes. Both are pure projections — no mutation. */

import type { GameState, LedgerEntry } from './types'
import type { EngineCatalog } from './catalogFrom'
import { unsatisfiedPorts } from './ports'

export interface DesignSummaryView {
  readonly budget: number
  /** Sum of tier cost_month across all instances. */
  readonly spent: number
  readonly unsatisfiedPorts: readonly { readonly instance_id: string; readonly port: string }[]
  /** Weakness tag ids present on any live instance's current tier. */
  readonly exposedWeaknessIds: readonly string[]
}

export function designSummary(state: GameState, catalog: EngineCatalog): DesignSummaryView {
  let spent = 0
  const exposedSet = new Set<string>()

  for (const inst of state.instances) {
    const def = catalog.nodeById.get(inst.def_id)
    if (!def) continue
    const tier = def.tiers.find((t: any) => t.tier === inst.tier)
    if (!tier) continue

    // Accumulate monthly cost
    spent += tier.stats?.cost_month ?? 0

    // Collect weakness tags on this tier
    const tierTags: string[] = tier.tags ?? []
    for (const tagId of tierTags) {
      const tagDef = catalog.tagById.get(tagId)
      if (tagDef?.kind === 'weakness') {
        exposedSet.add(tagId)
      }
    }
  }

  const badPorts = unsatisfiedPorts(state.instances, catalog).map((u) => ({
    instance_id: u.instance_id,
    port: u.port.port,
  }))

  return {
    budget: state.budget,
    spent,
    unsatisfiedPorts: badPorts,
    exposedWeaknessIds: [...exposedSet].sort(),
  }
}

export interface DebriefSummaryView {
  readonly scenario_name: string
  /** state.session.status === 'complete' && no open incidents */
  /** Survived the session window with reputation above zero. */
  readonly cleared: boolean
  readonly ticks: number
  readonly incidents_fired: number
  readonly incidents_resolved: number
  readonly final_budget: number
  readonly final_reputation: number
  readonly final_users: number
  readonly ledger: readonly LedgerEntry[]
}

export function debriefSummary(state: GameState, catalog: EngineCatalog): DebriefSummaryView {
  const scenario = catalog.scenarioById.get(state.scenario_id)
  const scenarioName: string = scenario?.name ?? state.scenario_id

  // Cleared = survived the session with reputation above zero.
  // Incidents don't need to be resolved — the session ends when the clock runs out
  // OR when reputation stays at 0 for 10 ticks (the loss condition).
  const cleared =
    state.session.status === 'complete' && state.carried.reputation > 0

  return {
    scenario_name: scenarioName,
    cleared,
    ticks: state.tick,
    incidents_fired: state.session.incidents_fired,
    incidents_resolved: state.session.incidents_resolved,
    final_budget: state.budget,
    final_reputation: state.carried.reputation,
    final_users: state.carried.users,
    ledger: state.ledger,
  }
}
