import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { startRun } from '../src/engine/session'
import type { GameState, TicketDef } from '../src/engine/types'
import { resolveHintTarget, actionBlockedReason } from '../src/ui/hintTarget'

const c = loadEngineCatalog()
const run = (): GameState => startRun(loadScenario('free-play', c), c)
const ticket = (id: string) => c.ticketById.get(id) as TicketDef
const instOf = (s: GameState, defId: string) => s.instances.find((i) => i.def_id === defId)!

describe('resolveHintTarget', () => {
  it('resolves a node_id ticket to that node, labelled with the action name', () => {
    const s = run()
    const t = resolveHintTarget(s, c, ticket('upgrade_db_t3'), 'upgrade_tier')
    expect(t).toEqual({ instanceId: instOf(s, 'postgres').instance_id, label: 'Upgrade Tier', disabledReason: null })
  })

  it('resolves a layers+tags ticket to a node in that layer offering the action', () => {
    const s = run()
    const t = resolveHintTarget(s, c, ticket('lb_multi_az'), 'enable_multi_az')
    expect(t.instanceId).toBe(instOf(s, 'load_balancer').instance_id)
    expect(t.disabledReason).toBeNull()
  })

  it('disables the button when no board node can take the action', () => {
    const s = run()
    const missing = { ...ticket('upgrade_db_t3'), id: 'x', requirement: { node_id: 'waf', min_tier: 2 } } as TicketDef
    const t = resolveHintTarget(s, c, missing, 'upgrade_tier')
    expect(t.instanceId).toBeNull()
    expect(t.disabledReason).toBe('No eligible node on the board')
  })

  it('carries the blocked reason when the action is cooling down', () => {
    const s = run()
    const pg = instOf(s, 'postgres')
    const cooling: GameState = {
      ...s,
      instances: s.instances.map((i) =>
        i === pg ? { ...i, action_cooldowns: { ...i.action_cooldowns, upgrade_tier: 120 } } : i,
      ),
    }
    const t = resolveHintTarget(cooling, c, ticket('upgrade_db_t3'), 'upgrade_tier')
    expect(t.instanceId).toBe(pg.instance_id)
    expect(t.disabledReason).toMatch(/.+/)
    expect(actionBlockedReason(cooling, c, pg.instance_id, 'upgrade_tier')).toBe(t.disabledReason)
  })

  it('reports an unknown instance', () => {
    expect(actionBlockedReason(run(), c, 'nope-1', 'upgrade_tier')).toBe('No affected instance')
  })
})
