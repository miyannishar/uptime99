import { describe, it, expect } from 'vitest'
import { checkTicketHints } from '../src/validate/ticketChecks'

// ─── shared fixtures ────────────────────────────────────────────────────────

/** Node with 3 tiers; backed_up and encrypted_at_rest arrive at higher tiers */
const node = {
  id: 'postgres',
  layer: 'data',
  tiers: [
    { tier: 1, tags: ['stateful'] },
    { tier: 2, tags: ['stateful', 'has_replica'] },
    { tier: 3, tags: ['stateful', 'has_replica', 'backed_up', 'encrypted_at_rest'] },
  ],
}

const actions = [
  { id: 'enable_backup', on_success: { tags_add: ['backed_up'] } },
  { id: 'upgrade_tier', on_success: {} },
  { id: 'add_replica', on_success: { tags_add: ['has_replica'] } },
  { id: 'rotate_credentials', on_success: { tags_add: ['secrets_rotated'] } },
  { id: 'rollback_deploy', on_success: {} },
]

/** matchable returns all tiers of the postgres node for any known action */
const matchable = (id: string) =>
  actions.some((a) => a.id === id)
    ? node.tiers.map((tier) => ({ node, tier }))
    : []

/** ticket with defaults that pass all rules */
const t = (over: any) => ({
  id: 'tk',
  requirement: { tags_any: ['backed_up'], layers: ['data'] },
  hint_actions: ['enable_backup'],
  ...over,
})

const scen = [{ id: 's', board: [{ def_id: 'postgres', tier: 1 }], ticket_ids: ['tk'] }]

// ─── Rule 1: hints non-empty and all known ───────────────────────────────────

describe('checkTicketHints', () => {
  it('accepts a valid ticket+scenario combination', () => {
    expect(checkTicketHints([t({})], scen, actions, matchable)).toEqual([])
  })

  it('rejects empty hint_actions', () => {
    const out = checkTicketHints([t({ hint_actions: [] })], scen, actions, matchable)
    expect(out.join()).toMatch(/ticket 'tk'/)
    expect(out.join()).toMatch(/empty/)
  })

  it('rejects unknown action id in hint_actions', () => {
    const out = checkTicketHints([t({ hint_actions: ['nonexistent'] })], scen, actions, matchable)
    expect(out.join()).toMatch(/ticket 'tk'/)
    expect(out.join()).toMatch(/unknown action/)
  })

  // ─── Rule 2: candidates non-empty ─────────────────────────────────────────

  it('rejects when primary hint matches no node in the requirement layer', () => {
    const out = checkTicketHints(
      [t({ requirement: { tags_any: ['backed_up'], layers: ['edge'] } })],
      scen, actions, matchable,
    )
    expect(out.join()).toMatch(/never offered/)
  })

  it('rejects when primary hint matches no node with the required node_id', () => {
    // matchable returns only 'postgres'; requirement asks for 'redis'
    const out = checkTicketHints(
      [t({ requirement: { node_id: 'redis', min_tier: 2 } })],
      [{ id: 's', board: [{ def_id: 'redis', tier: 1 }], ticket_ids: ['tk'] }],
      actions, matchable,
    )
    expect(out.join()).toMatch(/never offered/)
  })

  // ─── Rule 3: non-upgrade_tier tags_any must grant a required tag ───────────

  it('accepts enable_backup for tags_any:[backed_up]', () => {
    expect(checkTicketHints([t({})], scen, actions, matchable)).toEqual([])
  })

  it('rejects non-upgrade_tier that cannot grant the required tags_any tag', () => {
    const out = checkTicketHints(
      [t({ hint_actions: ['add_replica'] })],  // add_replica grants has_replica, not backed_up
      scen, actions, matchable,
    )
    expect(out.join()).toMatch(/cannot satisfy tags_any/)
  })

  it('accepts upgrade_tier for tags_any when a higher tier carries the tag', () => {
    // postgres T3 has backed_up; T3 > T1 (lowest), so upgrade_tier can reach it
    const out = checkTicketHints(
      [t({ hint_actions: ['upgrade_tier'] })],
      scen, actions, matchable,
    )
    expect(out).toEqual([])
  })

  it('rejects upgrade_tier for tags_any when no higher tier carries any required tag', () => {
    // Node with only one tier — no tier above lowest
    const singleTierNode = { id: 'redis', layer: 'data', tiers: [{ tier: 1, tags: [] }] }
    const m = (id: string) =>
      id === 'upgrade_tier' ? [{ node: singleTierNode, tier: singleTierNode.tiers[0] }] : []
    const out = checkTicketHints(
      [t({ hint_actions: ['upgrade_tier'], requirement: { tags_any: ['encrypted_at_rest'], layers: ['data'] } })],
      [{ id: 's', board: [{ def_id: 'redis', tier: 1 }], ticket_ids: ['tk'] }],
      actions, m,
    )
    expect(out.join()).toMatch(/cannot satisfy tags_any/)
  })

  // ─── Rule 3: non-upgrade_tier tags_all must grant ALL required tags ─────────

  it('accepts non-upgrade_tier that grants all tags_all tags', () => {
    const twoTagAction = { id: 'grant_two', on_success: { tags_add: ['backed_up', 'encrypted_at_rest'] } }
    const m = (id: string) => [{ node, tier: node.tiers[0] }].filter(() => true)
    const out = checkTicketHints(
      [t({ requirement: { tags_all: ['backed_up', 'encrypted_at_rest'], layers: ['data'] },
           hint_actions: ['grant_two'] })],
      scen, [...actions, twoTagAction], m,
    )
    expect(out).toEqual([])
  })

  it('rejects non-upgrade_tier that does NOT grant all tags_all tags (no candidate-tier exemption)', () => {
    // add_replica grants has_replica; the candidate postgres T3 has backed_up but that is
    // NOT an exemption for non-upgrade_tier actions
    const out = checkTicketHints(
      [t({ requirement: { tags_all: ['backed_up'], layers: ['data'] },
           hint_actions: ['add_replica'] })],
      scen, actions, matchable,
    )
    expect(out.join()).toMatch(/cannot satisfy tags_all/)
  })

  it('accepts upgrade_tier for tags_all when a higher tier carries all required tags', () => {
    // postgres T3 has both backed_up and encrypted_at_rest; T3 > T1
    const out = checkTicketHints(
      [t({ requirement: { tags_all: ['backed_up', 'encrypted_at_rest'], layers: ['data'] },
           hint_actions: ['upgrade_tier'] })],
      scen, actions, matchable,
    )
    expect(out).toEqual([])
  })

  it('rejects upgrade_tier for tags_all when no single higher tier carries all required tags', () => {
    // Node whose T2 has one tag and T3 has the other, but no tier has both
    const splitNode = {
      id: 'postgres', layer: 'data',
      tiers: [
        { tier: 1, tags: [] },
        { tier: 2, tags: ['backed_up'] },
        { tier: 3, tags: ['encrypted_at_rest'] },
      ],
    }
    const m = (id: string) =>
      id === 'upgrade_tier' ? splitNode.tiers.map((tier) => ({ node: splitNode, tier })) : []
    const out = checkTicketHints(
      [t({ requirement: { tags_all: ['backed_up', 'encrypted_at_rest'], layers: ['data'] },
           hint_actions: ['upgrade_tier'] })],
      scen, actions, m,
    )
    expect(out.join()).toMatch(/cannot satisfy tags_all/)
  })

  // ─── Rule 3: min_tier ────────────────────────────────────────────────────────

  it('accepts upgrade_tier as primary for a min_tier requirement', () => {
    const out = checkTicketHints(
      [t({ requirement: { node_id: 'postgres', min_tier: 2 }, hint_actions: ['upgrade_tier'] })],
      scen, actions, matchable,
    )
    expect(out).toEqual([])
  })

  it('rejects non-upgrade_tier as primary for a min_tier requirement', () => {
    const out = checkTicketHints(
      [t({ requirement: { node_id: 'postgres', min_tier: 2 }, hint_actions: ['enable_backup'] })],
      scen, actions, matchable,
    )
    expect(out.join()).toMatch(/not 'upgrade_tier'/)
  })

  // ─── Rule 3: min_count ───────────────────────────────────────────────────────

  it('rejects min_count on a node absent from the scenario board', () => {
    const out = checkTicketHints(
      [t({ requirement: { node_id: 'waf', min_count: 1 } })],
      scen, actions, matchable,
    )
    expect(out.join()).toMatch(/cannot/)
  })

  it('accepts min_count when the scenario board already has the node', () => {
    const scenWithNode = [{ id: 's', board: [{ def_id: 'postgres', tier: 1 }, { def_id: 'waf', tier: 1 }], ticket_ids: ['tk'] }]
    const wafNode = { id: 'waf', layer: 'edge', tiers: [{ tier: 1, tags: [] }] }
    const m = (id: string) =>
      actions.some((a) => a.id === id) ? [{ node: wafNode, tier: wafNode.tiers[0] }] : []
    const out = checkTicketHints(
      [t({ requirement: { node_id: 'waf', min_count: 1 }, hint_actions: ['enable_backup'] })],
      scenWithNode, actions, m,
    )
    const countErrors = out.filter((e) => e.includes('cannot'))
    expect(countErrors).toHaveLength(0)
  })

  // ─── Rule 4: board node among candidates per scenario ─────────────────────

  it('rejects ticket when no board node is a candidate for the primary hint', () => {
    const scenWithRedis = [{ id: 's', board: [{ def_id: 'redis', tier: 1 }], ticket_ids: ['tk'] }]
    const out = checkTicketHints([t({})], scenWithRedis, actions, matchable)
    expect(out.join()).toMatch(/no board node/)
  })

  it('accepts when a board node is among the candidates', () => {
    expect(checkTicketHints([t({})], scen, actions, matchable)).toEqual([])
  })

  // ─── Rule 5: scenario ticket_ids must reference known ticket ids ───────────

  it('rejects an unknown ticket id in a scenario', () => {
    const out = checkTicketHints([], scen, actions, matchable)
    expect(out.join()).toMatch(/'tk'/)
    expect(out.join()).toMatch(/unknown ticket id/)
  })

  it('accepts when all scenario ticket_ids are known', () => {
    expect(checkTicketHints([t({})], scen, actions, matchable)).toEqual([])
  })

  // ─── Rule 6: upgrade_tier ≤ 6, others ≤ 3 ─────────────────────────────────

  it('rejects more than 6 upgrade_tier primary tickets in scenarios', () => {
    const manyTickets = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`,
      requirement: { node_id: 'postgres', min_tier: 2 },
      hint_actions: ['upgrade_tier'],
    }))
    const manyScen = [{
      id: 's',
      board: [{ def_id: 'postgres', tier: 1 }],
      ticket_ids: manyTickets.map((tk) => tk.id),
    }]
    const m = (id: string) =>
      id === 'upgrade_tier' ? node.tiers.map((tier) => ({ node, tier })) : []
    const out = checkTicketHints(manyTickets, manyScen, [{ id: 'upgrade_tier', on_success: {} }], m)
    expect(out.join()).toMatch(/upgrade_tier/)
    expect(out.join()).toMatch(/maximum is 6/)
  })

  it('does not count orphaned tickets (not in any scenario) toward rule 6', () => {
    const sixScenario = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      requirement: { node_id: 'postgres', min_tier: 2 },
      hint_actions: ['upgrade_tier'],
    }))
    const orphan = {
      id: 'orphan',
      requirement: { node_id: 'postgres', min_tier: 2 },
      hint_actions: ['upgrade_tier'],
    }
    const sixScen = [{
      id: 's',
      board: [{ def_id: 'postgres', tier: 1 }],
      ticket_ids: sixScenario.map((tk) => tk.id),
    }]
    const m = (id: string) =>
      id === 'upgrade_tier' ? node.tiers.map((tier) => ({ node, tier })) : []
    const out = checkTicketHints(
      [...sixScenario, orphan], sixScen,
      [{ id: 'upgrade_tier', on_success: {} }], m,
    )
    const rule6Errors = out.filter((e) => e.includes('maximum'))
    expect(rule6Errors).toHaveLength(0)
  })

  it('rejects more than 3 uses of a non-upgrade_tier primary in scenarios', () => {
    const fourTickets = Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      requirement: { tags_any: ['backed_up'], layers: ['data'] },
      hint_actions: ['enable_backup'],
    }))
    const fourScen = [{
      id: 's',
      board: [{ def_id: 'postgres', tier: 1 }],
      ticket_ids: fourTickets.map((tk) => tk.id),
    }]
    const out = checkTicketHints(fourTickets, fourScen, actions, matchable)
    expect(out.join()).toMatch(/enable_backup/)
    expect(out.join()).toMatch(/maximum is 3/)
  })

  // ─── Rule 7: primary clickable at starting tier ──────────────────────────

  it('accepts when primary is offered at the board entry starting tier', () => {
    // enable_backup is available at postgres T1 (has stateful in T1 tags)
    // Our matchable returns T1 so the starting tier T1 is a candidate
    const out = checkTicketHints([t({})], scen, actions, matchable)
    expect(out).toEqual([])
  })

  it('rejects when primary is not offered at the starting tier (available only at a higher tier)', () => {
    // rollback_deploy matches only T3 (has has_replica+backed_up+encrypted_at_rest)
    // but board starts at T1 — not in candidates
    const rollbackMatchable = (id: string) =>
      id === 'rollback_deploy'
        ? [{ node, tier: node.tiers[2] }]  // only T3
        : node.tiers.map((tier) => ({ node, tier }))
    const out = checkTicketHints(
      [t({ requirement: { tags_any: ['backed_up'], layers: ['data'] }, hint_actions: ['rollback_deploy'] })],
      scen, actions, rollbackMatchable,
    )
    // rule 3: rollback_deploy grants nothing → fails tags_any
    // rule 7: rollback_deploy only at T3, board starts at T1 → also fails
    expect(out.join()).toMatch(/ticket 'tk'/)
  })

  it('upgrade_tier rule 7: exempt when node is not at top tier', () => {
    // Board has postgres at T1; top tier is T3 → T1 < T3 → exempt → rule 7 passes
    const out = checkTicketHints(
      [t({ hint_actions: ['upgrade_tier'] })],
      scen, actions, matchable,
    )
    expect(out).toEqual([])
  })

  it('upgrade_tier rule 7: fails when the only relevant board node is already at top tier', () => {
    // Board has postgres at T3 (top); upgrade_tier would be at top → NOT exempt
    const scenAtTop = [{ id: 's', board: [{ def_id: 'postgres', tier: 3 }], ticket_ids: ['tk'] }]
    const out = checkTicketHints(
      [t({ hint_actions: ['upgrade_tier'] })],
      scenAtTop, actions, matchable,
    )
    expect(out.join()).toMatch(/already at top tier/)
  })

  it('rule 7 does not fire for orphaned tickets (not in any scenario)', () => {
    // Ticket not in any scenario — rule 7 check is skipped, no errors from rule 7
    const orphanTicket = t({
      id: 'orphan',
      hint_actions: ['rollback_deploy'],
    })
    const out = checkTicketHints([orphanTicket], [], actions, matchable)
    const rule7Errors = out.filter((e) => e.includes("starting tier"))
    expect(rule7Errors).toHaveLength(0)
  })
})
