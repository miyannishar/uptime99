/* Which node a ticket's hint button acts on, and whether it can act right now.
   Relative engine imports (not @engine) so vitest can load this module. */

import { actionsFor } from '../engine/actions'
import type { EngineCatalog } from '../engine/catalogFrom'
import type { GameState, TicketDef } from '../engine/types'

export interface HintTarget {
  readonly instanceId: string | null
  readonly label: string
  readonly disabledReason: string | null
}

const NO_NODE = 'No eligible node on the board'

function viewFor(state: GameState, catalog: EngineCatalog, instanceId: string, actionId: string) {
  return actionsFor(state, instanceId, catalog).find((v) => v.action_id === actionId)
}

/**
 * First board instance that satisfies the ticket's node_id/layers filter and is
 * offered the action. Disabled (with the engine's reason) when that action is
 * cooling down, unaffordable or provisioning.
 */
export function resolveHintTarget(
  state: GameState,
  catalog: EngineCatalog,
  ticket: TicketDef,
  actionId: string,
): HintTarget {
  const label = (catalog.actionById.get(actionId) as { name?: string } | undefined)?.name ?? actionId
  const req = ticket.requirement as { node_id?: string; layers?: readonly string[] }

  for (const inst of state.instances) {
    if (req.node_id !== undefined && inst.def_id !== req.node_id) continue
    if (req.layers !== undefined) {
      const layer = (catalog.nodeById.get(inst.def_id) as { layer?: string } | undefined)?.layer
      if (!layer || !req.layers.includes(layer)) continue
    }
    const view = viewFor(state, catalog, inst.instance_id, actionId)
    if (!view) continue
    return {
      instanceId: inst.instance_id,
      label,
      disabledReason: view.availability === 'ready' ? null : (view.blockedReason ?? view.availability),
    }
  }
  return { instanceId: null, label, disabledReason: NO_NODE }
}

/** Why an incident's action button on this instance cannot be played, or null. */
export function actionBlockedReason(
  state: GameState,
  catalog: EngineCatalog,
  instanceId: string,
  actionId: string,
): string | null {
  if (!state.instances.some((i) => i.instance_id === instanceId)) return 'No affected instance'
  const view = viewFor(state, catalog, instanceId, actionId)
  if (!view) return 'Not offered on this node'
  return view.availability === 'ready' ? null : (view.blockedReason ?? view.availability)
}
