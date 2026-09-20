import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { isTicketComplete, processTickets, ticketsToActivate } from '../src/engine/tickets'
import type { GameState, NodeInstance, TicketDef } from '../src/engine/types'

const c = loadEngineCatalog()
const base = loadScenario('slice-oom-kill', c)

/** Build a NodeInstance for testing. */
const inst = (
  instance_id: string,
  def_id: string,
  tier: number,
  over: Partial<NodeInstance> = {},
): NodeInstance => ({
  instance_id, def_id, tier, region: 'us-east-1a',
  health: 100, utilization_pct: 0, down: false,
  tags_runtime: [], action_cooldowns: {}, edges_out: [],
  provisioning_until_tick: null, created_tick: 0, ...over,
})

/** Build a minimal run-phase state with the given tick and instances. */
const stateAt = (tick: number, instances: readonly NodeInstance[], over: Partial<GameState> = {}): GameState => ({
  ...base,
  phase: 'run',
  rng_seed: 42,
  tick,
  instances,
  ...over,
})

// ------------------------------------------------------------------
// scale_app_t2: Shape A — node_id: "app_cluster", min_tier: 2
// appears_at_tick: 3, deadline_ticks: 25, bonus_reputation: 8,
// reputation_penalty_per_tick: 0.5
// ------------------------------------------------------------------
const ticketA = c.ticketById.get('scale_app_t2') as TicketDef

// encrypt_db: Shape C — tags_all: ["encrypted_at_rest"], layers: ["data"]
const ticketC_all = c.ticketById.get('encrypt_db') as TicketDef
// add_db_replica: Shape C — tags_any: ["has_replica"], layers: ["data"]
const ticketC_any = c.ticketById.get('add_db_replica') as TicketDef
// dr_region_ready: Shape B — node_id: "backup_system", min_count: 1
const ticketB = c.ticketById.get('dr_region_ready') as TicketDef

describe('isTicketComplete', () => {
  describe('Shape A — node_id + min_tier', () => {
    it('returns true when the node is at exactly min_tier', () => {
      const state = stateAt(5, [inst('app-cluster-1', 'app_cluster', 2)])
      expect(isTicketComplete(state, c, ticketA)).toBe(true)
    })

    it('returns true when the node is above min_tier', () => {
      const state = stateAt(5, [inst('app-cluster-1', 'app_cluster', 3)])
      expect(isTicketComplete(state, c, ticketA)).toBe(true)
    })

    it('returns false when the node is below min_tier', () => {
      const state = stateAt(5, [inst('app-cluster-1', 'app_cluster', 1)])
      expect(isTicketComplete(state, c, ticketA)).toBe(false)
    })

    it('returns false when the node is not on the board at all', () => {
      const state = stateAt(5, [inst('postgres-1', 'postgres', 2)])
      expect(isTicketComplete(state, c, ticketA)).toBe(false)
    })

    it('returns true when one of multiple instances of the same node meets min_tier', () => {
      const state = stateAt(5, [
        inst('app-cluster-1', 'app_cluster', 1),
        inst('app-cluster-2', 'app_cluster', 2),
      ])
      expect(isTicketComplete(state, c, ticketA)).toBe(true)
    })
  })

  describe('Shape B — node_id + min_count', () => {
    it('returns true when at least min_count instances of the node exist', () => {
      // dr_region_ready: node_id "backup_system", min_count 1
      const state = stateAt(5, [inst('backup-system-1', 'backup_system', 1)])
      expect(isTicketComplete(state, c, ticketB)).toBe(true)
    })

    it('returns false when fewer than min_count instances exist', () => {
      // No backup_system on board
      const state = stateAt(5, [inst('app-cluster-1', 'app_cluster', 1)])
      expect(isTicketComplete(state, c, ticketB)).toBe(false)
    })
  })

  describe('Shape C — layers + tags', () => {
    it('returns true when tags_all match on a node in the required layer', () => {
      // encrypt_db: tags_all ["encrypted_at_rest"], layers ["data"]
      // postgres tier 3 carries encrypted_at_rest
      const state = stateAt(5, [inst('postgres-1', 'postgres', 3)])
      expect(isTicketComplete(state, c, ticketC_all)).toBe(true)
    })

    it('returns false when tags_all do not match', () => {
      // postgres tier 1 does NOT carry encrypted_at_rest
      const state = stateAt(5, [inst('postgres-1', 'postgres', 1)])
      expect(isTicketComplete(state, c, ticketC_all)).toBe(false)
    })

    it('returns true when tags_any match on a node in the required layer', () => {
      // add_db_replica: tags_any ["has_replica"], layers ["data"]
      // postgres tier 2 carries has_replica
      const state = stateAt(5, [inst('postgres-1', 'postgres', 2)])
      expect(isTicketComplete(state, c, ticketC_any)).toBe(true)
    })

    it('returns false when no tags_any tag matches', () => {
      // postgres tier 1 does NOT carry has_replica
      const state = stateAt(5, [inst('postgres-1', 'postgres', 1)])
      expect(isTicketComplete(state, c, ticketC_any)).toBe(false)
    })

    it('returns false when the node is in the wrong layer', () => {
      // app_cluster is compute, not data — neither ticket_C shape applies
      const state = stateAt(5, [inst('app-cluster-1', 'app_cluster', 3)])
      expect(isTicketComplete(state, c, ticketC_all)).toBe(false)
    })

    it('returns true when the tag is supplied via tags_runtime (not tier definition)', () => {
      // Simulate a runtime tag granting encrypted_at_rest on postgres tier 1
      const state = stateAt(5, [
        inst('postgres-1', 'postgres', 1, { tags_runtime: ['encrypted_at_rest'] }),
      ])
      expect(isTicketComplete(state, c, ticketC_all)).toBe(true)
    })
  })
})

describe('ticketsToActivate', () => {
  it('returns tickets whose appears_at_tick equals state.tick', () => {
    // scale_app_t2 appears_at_tick: 3
    const state = stateAt(3, base.instances)
    const toActivate = ticketsToActivate(state, c)
    expect(toActivate.map((t) => t.id)).toContain('scale_app_t2')
  })

  it('returns nothing before appears_at_tick', () => {
    // tick 2 — scale_app_t2 appears at tick 3, should not activate yet
    const state = stateAt(2, base.instances)
    const toActivate = ticketsToActivate(state, c)
    expect(toActivate.map((t) => t.id)).not.toContain('scale_app_t2')
  })

  it('returns nothing after appears_at_tick (already past)', () => {
    // tick 10 — scale_app_t2 appears at tick 3, should NOT re-activate
    const state = stateAt(10, base.instances)
    const toActivate = ticketsToActivate(state, c)
    expect(toActivate.map((t) => t.id)).not.toContain('scale_app_t2')
  })

  it('returns nothing for tickets already in active_tickets', () => {
    const state = stateAt(3, base.instances, {
      active_tickets: [{
        ticket_id: 'scale_app_t2',
        started_tick: 3,
        deadline_tick: 28,
        completed: false,
        completion_tick: null,
      }],
    })
    const toActivate = ticketsToActivate(state, c)
    expect(toActivate.map((t) => t.id)).not.toContain('scale_app_t2')
  })
})

describe('processTickets', () => {
  it('activates a ticket on its appears_at_tick', () => {
    // slice-oom-kill has ticket_ids: ["scale_app_t2"], appears_at_tick: 3
    const state = stateAt(3, base.instances)
    const out = processTickets(state, c)
    expect(out.active_tickets).toHaveLength(1)
    expect(out.active_tickets[0].ticket_id).toBe('scale_app_t2')
    expect(out.active_tickets[0].started_tick).toBe(3)
    expect(out.active_tickets[0].deadline_tick).toBe(3 + 25)
    expect(out.active_tickets[0].completed).toBe(false)
  })

  it('does NOT activate a ticket before its appears_at_tick', () => {
    const state = stateAt(2, base.instances)
    const out = processTickets(state, c)
    expect(out.active_tickets).toHaveLength(0)
  })

  it('does NOT activate a ticket after its appears_at_tick (tick strictly greater)', () => {
    // Tick 10 > appears_at_tick 3 — should not activate since activation is tick-exact
    const state = stateAt(10, base.instances)
    const out = processTickets(state, c)
    expect(out.active_tickets).toHaveLength(0)
  })

  it('marks a ticket complete and awards bonus_reputation when requirement is met', () => {
    // Activate at tick 3, then at tick 4 check with app_cluster at tier 2 (meets requirement)
    const activated = processTickets(stateAt(3, base.instances), c)
    // Now advance to tick 4 with upgraded app_cluster
    const upgraded = stateAt(4, [
      ...base.instances.filter((i) => i.def_id !== 'app_cluster'),
      inst('app-cluster-1', 'app_cluster', 2),
    ], { active_tickets: activated.active_tickets })
    const startReputation = 100
    const out = processTickets({ ...upgraded, carried: { ...upgraded.carried, reputation: startReputation } }, c)
    const rec = out.active_tickets.find((t) => t.ticket_id === 'scale_app_t2')!
    expect(rec.completed).toBe(true)
    expect(rec.completion_tick).toBe(4)
    // bonus_reputation: 8 → capped at 100 since we start at 100
    expect(out.carried.reputation).toBe(Math.min(100, startReputation + 8))
  })

  it('awards bonus_reputation below 100 when reputation has room', () => {
    const activated = processTickets(stateAt(3, base.instances), c)
    const upgraded = stateAt(4, [
      ...base.instances.filter((i) => i.def_id !== 'app_cluster'),
      inst('app-cluster-1', 'app_cluster', 2),
    ], { active_tickets: activated.active_tickets })
    const startReputation = 85
    const out = processTickets({ ...upgraded, carried: { ...upgraded.carried, reputation: startReputation } }, c)
    // bonus_reputation for scale_app_t2 is 8
    expect(out.carried.reputation).toBe(startReputation + 8)
  })

  it('applies reputation_penalty_per_tick for overdue incomplete tickets', () => {
    // Activate at tick 3, then check at tick > deadline_tick (3 + 25 = 28), so tick 29
    const activated = processTickets(stateAt(3, base.instances), c)
    const overdue = stateAt(29, base.instances, { active_tickets: activated.active_tickets })
    const startReputation = 80
    const out = processTickets({ ...overdue, carried: { ...overdue.carried, reputation: startReputation } }, c)
    const rec = out.active_tickets.find((t) => t.ticket_id === 'scale_app_t2')!
    // Should still be incomplete (app_cluster still at tier 1)
    expect(rec.completed).toBe(false)
    // reputation_penalty_per_tick: 0.5 → floor at 0
    expect(out.carried.reputation).toBe(Math.max(0, startReputation - 0.5))
  })

  it('does NOT apply penalty for a ticket that is completed this tick (even if overdue)', () => {
    // Activate at tick 3, but set deadline_tick to 5, then complete at tick 6 (overdue)
    // Bonuses apply before penalties, so completing cancels the penalty for that ticket
    const overdueAndCompleted: typeof base.active_tickets = [{
      ticket_id: 'scale_app_t2',
      started_tick: 3,
      deadline_tick: 5,    // deadline already passed
      completed: false,
      completion_tick: null,
    }]
    const state = stateAt(6, [
      ...base.instances.filter((i) => i.def_id !== 'app_cluster'),
      inst('app-cluster-1', 'app_cluster', 2),
    ], { active_tickets: overdueAndCompleted })
    const startReputation = 80
    const out = processTickets({ ...state, carried: { ...state.carried, reputation: startReputation } }, c)
    const rec = out.active_tickets.find((t) => t.ticket_id === 'scale_app_t2')!
    expect(rec.completed).toBe(true)
    // Bonus applied (scale_app_t2.bonus_reputation = 8), NO penalty because completed
    expect(out.carried.reputation).toBe(Math.min(100, startReputation + 8))
  })

  it('does NOT penalise already-completed tickets', () => {
    // A completed ticket from a previous tick should never re-apply bonus or penalty
    const completedRecord: typeof base.active_tickets = [{
      ticket_id: 'scale_app_t2',
      started_tick: 3,
      deadline_tick: 5,   // already overdue
      completed: true,
      completion_tick: 4,
    }]
    const state = stateAt(10, base.instances, { active_tickets: completedRecord })
    const startReputation = 80
    const out = processTickets({ ...state, carried: { ...state.carried, reputation: startReputation } }, c)
    // No bonus (already completed), no penalty (already completed)
    expect(out.carried.reputation).toBe(startReputation)
  })

  it('reputation penalty floors at 0', () => {
    const overdueRecord: typeof base.active_tickets = [{
      ticket_id: 'scale_app_t2',
      started_tick: 3,
      deadline_tick: 5,
      completed: false,
      completion_tick: null,
    }]
    const state = stateAt(10, base.instances, { active_tickets: overdueRecord })
    const out = processTickets({ ...state, carried: { ...state.carried, reputation: 0 } }, c)
    expect(out.carried.reputation).toBe(0)
  })

  it('reputation bonus caps at 100', () => {
    const activated = processTickets(stateAt(3, base.instances), c)
    const upgraded = stateAt(4, [
      ...base.instances.filter((i) => i.def_id !== 'app_cluster'),
      inst('app-cluster-1', 'app_cluster', 2),
    ], { active_tickets: activated.active_tickets })
    const out = processTickets({ ...upgraded, carried: { ...upgraded.carried, reputation: 99 } }, c)
    // bonus_reputation: 8, but caps at 100
    expect(out.carried.reputation).toBe(100)
  })

  it('is pure: does not mutate the input state', () => {
    const state = stateAt(3, base.instances)
    const before = structuredClone(state)
    processTickets(state, c)
    expect(state).toEqual(before)
  })

  it('returns active_tickets array independent of input (immutability)', () => {
    const state = stateAt(3, base.instances)
    const out = processTickets(state, c)
    // Mutating output should not affect the original
    expect(out.active_tickets).not.toBe(state.active_tickets)
  })

  it('produces empty active_tickets for a scenario with no ticket_ids', () => {
    // free-play has ticket_ids: [] — no tickets should activate
    const freePlayBase = loadScenario('free-play', c)
    const state = { ...freePlayBase, phase: 'run' as const, rng_seed: 42, tick: 5 }
    const out = processTickets(state, c)
    expect(out.active_tickets).toHaveLength(0)
  })
})
