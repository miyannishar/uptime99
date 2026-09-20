/* Action resolution: given a node instance and the current game state, returns
   the full set of actions available on that instance with availability metadata.
   Also exports `tierLadder` for rendering upgrade paths in the UI. */

import type { GameState } from './types'
import type { EngineCatalog } from './catalogFrom'
import { matchActions, type MatchInput } from '../validate/matchActions'

export interface ResolvedActionView {
  readonly action_id: string
  readonly availability: 'ready' | 'cooldown' | 'unaffordable' | 'provisioning' | 'constraint'
  readonly cooldownRemainingS: number
  /** money_cost * emergency_premium_multiplier when node.down or health < 25 */
  readonly effectiveMoneyCost: number
  /** time_cost_s (0 for upgrade_tier — read from target tier instead) */
  readonly effectiveTimeCostS: number
  readonly resolvesActiveIncident: boolean
  readonly fromActionsExtra: boolean
  readonly blockedReason?: string
}

export function actionsFor(
  state: GameState,
  instanceId: string,
  catalog: EngineCatalog,
): ResolvedActionView[] {
  const inst = state.instances.find((i) => i.instance_id === instanceId)
  if (!inst) return []

  const def = catalog.nodeById.get(inst.def_id)
  if (!def) return []

  const tier = def.tiers.find((t: any) => t.tier === inst.tier)
  if (!tier) return []

  // Build combined tags: definition tags for this tier + runtime tags
  const definitionTags: string[] = tier.tags ?? []
  const allTags = [...definitionTags, ...inst.tags_runtime]

  const input: MatchInput = {
    layer: def.layer,
    role: def.role,
    node_id: def.id,
    tier: inst.tier,
    health: inst.health,
    tags: allTags,
    actions_extra: tier.actions_extra,
    actions_deny: tier.actions_deny,
  }

  const matchedIds = matchActions(input, catalog.actions as any)
  const actionsExtraSet = new Set<string>(tier.actions_extra ?? [])

  const emergencyMultiplier: number =
    (catalog.economy as any).emergency_premium_multiplier ?? 1

  // Which actions resolve an active incident on this instance?
  const incidentResolvingActions = new Set<string>()
  for (const record of state.incidents) {
    if (record.instance_id === instanceId) {
      const incidentDef = catalog.incidentById.get(record.incident_id)
      if (incidentDef) {
        for (const actionId of (incidentDef.resolved_by ?? [])) {
          incidentResolvingActions.add(actionId)
        }
      }
    }
  }

  return matchedIds.map((actionId) => {
    const action = catalog.actionById.get(actionId)
    if (!action) {
      // Shouldn't happen if integrity checks passed, but be safe
      return {
        action_id: actionId,
        availability: 'constraint' as const,
        cooldownRemainingS: 0,
        effectiveMoneyCost: 0,
        effectiveTimeCostS: 0,
        resolvesActiveIncident: false,
        fromActionsExtra: actionsExtraSet.has(actionId),
        blockedReason: 'Action definition not found',
      }
    }

    const isEmergency = inst.down || inst.health < 25
    const effectiveMoneyCost = isEmergency
      ? action.money_cost * emergencyMultiplier
      : action.money_cost

    const effectiveTimeCostS: number = action.time_cost_s ?? 0

    const cooldownRemainingS: number = inst.action_cooldowns[actionId] ?? 0

    // Availability in precedence order: provisioning > cooldown > unaffordable > ready
    let availability: ResolvedActionView['availability']
    let blockedReason: string | undefined

    if (
      inst.provisioning_until_tick !== null &&
      inst.provisioning_until_tick > state.tick
    ) {
      availability = 'provisioning'
      blockedReason = `Provisioning completes at tick ${inst.provisioning_until_tick}`
    } else if (cooldownRemainingS > 0) {
      availability = 'cooldown'
      blockedReason = `Cooldown: ${cooldownRemainingS}s remaining`
    } else if (effectiveMoneyCost > state.budget) {
      availability = 'unaffordable'
      blockedReason = `Costs ${effectiveMoneyCost} but budget is ${state.budget}`
    } else {
      availability = 'ready'
    }

    return {
      action_id: actionId,
      availability,
      cooldownRemainingS,
      effectiveMoneyCost,
      effectiveTimeCostS,
      resolvesActiveIncident: incidentResolvingActions.has(actionId),
      fromActionsExtra: actionsExtraSet.has(actionId),
      blockedReason,
    }
  })
}

export interface TierLadderView {
  readonly tier_number: number
  /** def.name + " tier " + n — tiers have no independent name field */
  readonly name: string
  readonly isCurrent: boolean
  /** tier.stats.cost_month - current tier's cost_month */
  readonly costDelta: number
  /** tier.tier > inst.tier + 1 — can only upgrade one step at a time */
  readonly locked: boolean
  readonly cost_month: number
}

export function tierLadder(
  state: GameState,
  instanceId: string,
  catalog: EngineCatalog,
): TierLadderView[] {
  const inst = state.instances.find((i) => i.instance_id === instanceId)
  if (!inst) return []

  const def = catalog.nodeById.get(inst.def_id)
  if (!def) return []

  const currentTierDef = def.tiers.find((t: any) => t.tier === inst.tier)
  const currentCostMonth: number = currentTierDef?.stats?.cost_month ?? 0

  return (def.tiers as any[]).map((t: any) => ({
    tier_number: t.tier as number,
    name: `${def.name} tier ${t.tier}`,
    isCurrent: t.tier === inst.tier,
    costDelta: (t.stats?.cost_month ?? 0) - currentCostMonth,
    locked: t.tier > inst.tier + 1,
    cost_month: t.stats?.cost_month ?? 0,
  }))
}
