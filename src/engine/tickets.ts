/* Ticket activation, completion checking, and per-tick reputation adjustments.
   Pure module — no I/O, no Date.now(), no Math.random(). */

import type { EngineCatalog } from './catalogFrom'
import type { GameState, TicketDef, TicketRecord } from './types'

/**
 * Check whether the current board satisfies a ticket's requirement.
 * Three requirement shapes, checked in order:
 *   A — specific node_id at min_tier
 *   B — specific node_id with min_count
 *   C — any instance matching layers + tags
 */
export function isTicketComplete(
  state: GameState,
  catalog: EngineCatalog,
  ticket: TicketDef,
): boolean {
  const req = ticket.requirement
  const insts = state.instances

  // Shape A: specific node at minimum tier
  if (req.node_id !== undefined && req.min_tier !== undefined) {
    return insts.some((i) => {
      const def = catalog.nodeById.get(i.def_id)
      return def && def.id === req.node_id && i.tier >= req.min_tier!
    })
  }

  // Shape B: specific node_id with min_count
  if (req.node_id !== undefined && req.min_count !== undefined) {
    return insts.filter((i) => {
      const def = catalog.nodeById.get(i.def_id)
      return def && def.id === req.node_id
    }).length >= req.min_count!
  }

  // Shape C: any instance matching layers + tags (capability check)
  const candidates = insts.filter((i) => {
    const def = catalog.nodeById.get(i.def_id)
    if (!def) return false
    if (req.layers && !req.layers.includes(def.layer)) return false
    const tierDef = def.tiers.find((t: any) => t.tier === i.tier)
    const tags = new Set([...(tierDef?.tags ?? []), ...i.tags_runtime])
    if (req.tags_all && !req.tags_all.every((t: string) => tags.has(t))) return false
    if (req.tags_any && !req.tags_any.some((t: string) => tags.has(t))) return false
    return true
  })
  return candidates.length > 0
}

/**
 * Returns the TicketDef entries that should be activated this tick:
 * those whose appears_at_tick equals state.tick and that are not yet
 * present in state.active_tickets.
 */
export function ticketsToActivate(state: GameState, catalog: EngineCatalog): TicketDef[] {
  const scenario = catalog.scenarioById.get(state.scenario_id)
  const ticketIds: string[] = (scenario as any)?.ticket_ids ?? []
  const existingIds = new Set(state.active_tickets.map((r) => r.ticket_id))
  const result: TicketDef[] = []
  for (const id of ticketIds) {
    if (existingIds.has(id)) continue
    const ticket = catalog.ticketById.get(id) as TicketDef | undefined
    if (!ticket) continue
    if (ticket.appears_at_tick === state.tick) result.push(ticket)
  }
  return result
}

/**
 * Pure function — returns a new GameState with tickets activated, completed,
 * and/or penalised. Never mutates the input.
 *
 * Order:
 *   1. Activate tickets whose appears_at_tick equals state.tick.
 *   2. Complete: apply bonuses for all newly-completed tickets.
 *   3. Penalise: subtract per-tick penalty for overdue incomplete tickets.
 *
 * Bonuses are applied before penalties so a ticket that completes while
 * overdue is not doubly penalised.
 */
export function processTickets(state: GameState, catalog: EngineCatalog): GameState {
  const toActivate = ticketsToActivate(state, catalog)

  // 1. Activate new tickets
  const newRecords: TicketRecord[] = toActivate.map((ticket) => ({
    ticket_id: ticket.id,
    started_tick: state.tick,
    deadline_tick: state.tick + ticket.deadline_ticks,
    completed: false,
    completion_tick: null,
  }))
  let active: TicketRecord[] = [...state.active_tickets, ...newRecords]

  // 2. Complete: check each incomplete ticket; apply bonuses first
  let reputation = state.carried.reputation
  active = active.map((rec) => {
    if (rec.completed) return rec
    const ticket = catalog.ticketById.get(rec.ticket_id) as TicketDef | undefined
    if (!ticket) return rec
    if (isTicketComplete(state, catalog, ticket)) {
      reputation = Math.min(100, reputation + ticket.bonus_reputation)
      return { ...rec, completed: true, completion_tick: state.tick }
    }
    return rec
  })

  // 3. Penalise: subtract penalty for overdue incomplete tickets
  for (const rec of active) {
    if (rec.completed) continue
    const ticket = catalog.ticketById.get(rec.ticket_id) as TicketDef | undefined
    if (!ticket) continue
    if (state.tick > rec.deadline_tick) {
      reputation = Math.max(0, reputation - ticket.reputation_penalty_per_tick)
    }
  }

  return {
    ...state,
    active_tickets: active,
    carried: { ...state.carried, reputation },
  }
}
