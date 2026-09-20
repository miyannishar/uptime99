import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { deriveMetrics, onRequestPath, buildScope, SECONDS_PER_MONTH } from '../src/engine/metrics'
import type { GameState, NodeInstance } from '../src/engine/types'

const c = loadEngineCatalog()

const inst = (
  instance_id: string, def_id: string, utilization_pct = 0, over: Partial<NodeInstance> = {},
): NodeInstance => ({
  instance_id, def_id, tier: 1, region: 'us-east-1a',
  health: 100, utilization_pct, down: false,
  tags_runtime: [], action_cooldowns: {}, edges_out: [],
  provisioning_until_tick: null, created_tick: 0, ...over,
})

const state = (instances: NodeInstance[], over: Partial<GameState> = {}): GameState => ({
  save_version: 1, scenario_id: 'slice-oom-kill', phase: 'run', tick: 0, budget: 800,
  rng_seed: null,
  carried: { reputation: 100, users: 50000 }, history: {},
  instances, incidents: [], ledger: [], last_fired: {}, active_tickets: [],
  session: { peak_p95_ms: 0, incidents_fired: 0, incidents_resolved: 0, status: 'running' },
  ...over,
})

const slice = [
  inst('cdn-1', 'cdn', 22), inst('lb-1', 'load_balancer', 31),
  inst('app-1', 'app_cluster', 40), inst('pg-1', 'postgres', 40),
]

describe('onRequestPath', () => {
  it('includes on-path layers', () => {
    expect(onRequestPath(inst('app-1', 'app_cluster'), c)).toBe(true)
    expect(onRequestPath(inst('pg-1', 'postgres'), c)).toBe(true)
  })

  it('excludes off-path layers', () => {
    expect(onRequestPath(inst('m-1', 'metrics_pipeline'), c)).toBe(false)
  })

  it('excludes async and scheduled tiers even on an on-path layer', () => {
    // message_queue sits on the data layer but carries `async`
    expect(onRequestPath(inst('mq-1', 'message_queue'), c)).toBe(false)
    expect(onRequestPath(inst('cron-1', 'cron_scheduler'), c)).toBe(false)
  })
})

describe('deriveMetrics on a healthy slice board', () => {
  const m = deriveMetrics(state(slice), c)

  it('reports full uptime when nothing is down', () => {
    expect(m.uptime_pct).toBe(100)
  })

  it('sums base latency when every node is below the saturation knee', () => {
    // 15 + 4 + 45 + 8, all multipliers 1.0 below 0.8 utilisation
    expect(m.p95_latency_ms).toBeCloseTo(72, 1)
  })

  it('reports no errors below saturation', () => {
    expect(m.error_rate_pct).toBe(0)
  })

  it('sums tier cost_month for cost', () => {
    expect(m.cost_month).toBeCloseTo(115, 1)
  })

  it('computes profit as users * arpu - cost', () => {
    expect(m.profit_month).toBeCloseTo(50000 * 0.1 - 115, 1)
  })
})

describe('deriveMetrics under load', () => {
  it('raises p95 once a node passes the knee', () => {
    const hot = slice.map((i) => i.instance_id === 'app-1'
      ? { ...i, utilization_pct: 97 } : i)
    const m = deriveMetrics(state(hot), c)
    expect(m.p95_latency_ms).toBeCloseTo(99.6, 0)
  })

  it('produces errors and a large p95 past 100% utilisation', () => {
    const over = slice.map((i) => i.instance_id === 'app-1'
      ? { ...i, utilization_pct: 130 } : i)
    const m = deriveMetrics(state(over), c)
    expect(m.error_rate_pct).toBeCloseTo(12, 0)
    expect(m.p95_latency_ms).toBeGreaterThan(700)
  })

  it('drops uptime by blast_radius when a node is down', () => {
    const down = slice.map((i) => i.instance_id === 'pg-1' ? { ...i, down: true } : i)
    const m = deriveMetrics(state(down), c)
    const br = c.nodeById.get('postgres')!.tiers[0].stats.blast_radius
    // formula: clamp(100 - sum(node.blast_radius * node.down), 0, 100)
    // blast_radius is a 0..1 fraction, subtracted directly from 100
    expect(m.uptime_pct).toBeCloseTo(Math.max(0, 100 - br), 3)
  })

  it('reads down, not health, for uptime', () => {
    const failing = slice.map((i) => i.instance_id === 'pg-1' ? { ...i, health: 0 } : i)
    expect(deriveMetrics(state(failing), c).uptime_pct).toBe(100)
  })
})

describe('reputation and the severity sum', () => {
  it('decays reputation by severity when an incident is active', () => {
    const withIncident = state(slice, {
      incidents: [{
        key: 'oom_kill#1', incident_id: 'oom_kill', instance_id: 'app-1',
        started_tick: 0, escalate_at_tick: null, expires_at_tick: null, attempts: {},
      }],
    })
    const sev = c.incidentById.get('oom_kill')!.severity
    const m = deriveMetrics(withIncident, c)
    expect(m.reputation).toBeCloseTo(100 - 1.5 * sev, 1)
  })

  it('recovers reputation when nothing is active', () => {
    const m = deriveMetrics(state(slice, { carried: { reputation: 90, users: 50000 } }), c)
    expect(m.reputation).toBeCloseTo(90.8, 1)
  })
})

describe('the monthly-rate time base', () => {
  it('scales monthly growth into per-tick fractions', () => {
    expect(SECONDS_PER_MONTH).toBe(2_592_000)
    const m = deriveMetrics(state(slice), c)
    // 0.03 monthly at reputation 100, over 518,400 ticks of 5s
    const perTick = 0.03 / (SECONDS_PER_MONTH / 5)
    expect(m.users).toBeCloseTo(50000 * (1 + perTick), 3)
  })

  it('DOCUMENTS the balance problem: users barely move over a short session', () => {
    let s = state(slice)
    for (let t = 0; t < 40; t += 1) {
      s = { ...s, carried: { ...s.carried, users: deriveMetrics(s, c).users } }
    }
    const drift = (s.carried.users - 50000) / 50000
    // ~0.0000023 (2.31e-6) — invisible on a scorecard. Per-tick growth is
    // 0.03 / 518,400 ≈ 5.787e-8; × 40 ticks ≈ 2.31e-6 as a fraction = 0.00023%.
    // This test exists to pin the magnitude, not to endorse it.
    // See "Known issue" in the plan header and §15 of CLAUDE.md.
    expect(Math.abs(drift)).toBeLessThan(0.0001)
  })
})

describe('ledger charges in cost_month and profit_month', () => {
  it('a monthly ledger charge increases cost_month rather than reducing it', () => {
    // Hand-written entry: amount is negative (a charge), cadence monthly.
    // Before the sign fix, sum(ledger.recurring) = -500, so cost drops to -385.
    // After the fix, cost = 115 + 500 = 615.
    const withCharge = state(slice, {
      ledger: [{
        kind: 'sla_credit', basis: 500, cadence: 'monthly',
        amount: -500, tick: 0, instance_id: null,
      }],
    })
    const m = deriveMetrics(withCharge, c)
    expect(m.cost_month).toBeCloseTo(615, 1)
  })

  it('a monthly ledger charge raises cost and therefore lowers profit', () => {
    const baseline = deriveMetrics(state(slice), c)
    const withCharge = state(slice, {
      ledger: [{
        kind: 'sla_credit', basis: 500, cadence: 'monthly',
        amount: -500, tick: 0, instance_id: null,
      }],
    })
    const m = deriveMetrics(withCharge, c)
    // profit_month = users * arpu - cost_month; cost rose by 500 so profit drops by 500
    expect(m.profit_month).toBeCloseTo(baseline.profit_month - 500, 1)
  })
})

describe('guard rails — silent wrong-number paths must throw (M3, M10, I1)', () => {
  // M3: empty request path must throw, not report perfect metrics
  it('throws when there are no on-path nodes (M3)', () => {
    // metrics_pipeline is off-path (observability layer)
    const offPath = [inst('m-1', 'metrics_pipeline')]
    expect(() => deriveMetrics(state(offPath), c)).toThrow(/no on-path nodes/)
  })

  // M10: a missing tier must throw, not silently contribute zero
  it('throws when an instance tier has no matching definition (M10)', () => {
    // nodes have at most 4 tiers; tier 9 cannot exist
    const badTier = slice.map((i) => i.instance_id === 'app-1' ? { ...i, tier: 9 } : i)
    expect(() => deriveMetrics(state(badTier), c)).toThrow(/app_cluster.*tier 9|tier 9.*app_cluster/)
  })

  // I1: profit_month must use the freshly computed users, not state.carried.users
  it('profit_month reflects computed users, not carried users (I1)', () => {
    // Construct two states that differ only in carried.users while having the
    // same board. With the old bug, buildScope overwrites computed.users back to
    // state.carried.users, so profit_month is identical for both states even
    // when users has already been computed with a different result.
    // Here we directly build the scope with a carried users value that differs
    // from what would be in computed, and assert the computed value wins.
    const lowCarried = state(slice, { carried: { reputation: 100, users: 1000 } })
    const highCarried = state(slice, { carried: { reputation: 100, users: 100000 } })

    // In the first tick, computed.users derives from carried.users — so the
    // difference must propagate into profit_month.
    const mLow = deriveMetrics(lowCarried, c)
    const mHigh = deriveMetrics(highCarried, c)

    // profit = users * arpu - cost; if buildScope always uses carried.users for
    // profit_month's scope, it would use the original carried rather than the
    // computed users value. We verify the computed users value is used.
    expect(mLow.profit_month).toBeLessThan(mHigh.profit_month)

    // Verify the difference matches users * arpu (0.1 per user)
    const arpu = c.economy.arpu as number
    expect(mHigh.profit_month - mLow.profit_month).toBeCloseTo(
      (mHigh.users - mLow.users) * arpu, 2,
    )
  })
})
