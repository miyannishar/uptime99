import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { advance } from '../src/engine/tick'
import { boardOf, metricsOf, statusOf, nodeStatusOf } from '../src/engine/view'
import { METRIC_IDS, type GameState, type NodeInstance } from '../src/engine/types'

const c = loadEngineCatalog()
const base = loadScenario('slice-oom-kill', c)

describe('boardOf', () => {
  const board = boardOf(base, c)

  it('returns one view per instance, in board order', () => {
    expect(board.map((b) => b.instance_id))
      .toEqual(['cdn-1', 'load-balancer-1', 'app-cluster-1', 'postgres-1'])
  })

  it('resolves the display name and layer from the definition', () => {
    const app = board.find((b) => b.instance_id === 'app-cluster-1')!
    expect(app.name).toBe('Application Cluster')
    expect(app.layer).toBe('compute')
  })

  it('carries the authored x/y from the scenario', () => {
    expect(board.find((b) => b.instance_id === 'cdn-1')).toMatchObject({ x: 40, y: 120 })
  })

  it('marks every slice node as on the request path', () => {
    expect(board.every((b) => b.onRequestPath)).toBe(true)
  })

  it('merges tier tags with tags_runtime', () => {
    const hot = {
      ...base,
      instances: base.instances.map((i) => i.instance_id === 'app-cluster-1'
        ? { ...i, tags_runtime: ['cold_cache'] } : i),
    }
    const app = boardOf(hot, c).find((b) => b.instance_id === 'app-cluster-1')!
    expect(app.tags).toContain('cold_cache')
  })

  it('reports status ok when healthy and bad when down', () => {
    expect(boardOf(base, c).every((b) => b.status === 'ok')).toBe(true)
    const down = {
      ...base,
      instances: base.instances.map((i) => i.instance_id === 'postgres-1'
        ? { ...i, down: true } : i),
    }
    expect(boardOf(down, c).find((b) => b.instance_id === 'postgres-1')!.status).toBe('bad')
  })

  it('positions match the authored scenario board entries (drift guard)', () => {
    // If instanceIdFor in scenario.ts ever changes its rule without view.ts
    // changing in step, every positions.get() returns undefined and nodes
    // silently fall back to {x:0, y:0}. This test catches that by asserting
    // each view's x/y equals the corresponding authored board entry.
    const scenario = c.scenarioById.get('slice-oom-kill')!
    const board = boardOf(base, c)
    scenario.board.forEach((entry: any, idx: number) => {
      expect(board[idx].x).toBe(entry.x)
      expect(board[idx].y).toBe(entry.y)
    })
  })

  it('counts provisioning ticks remaining against the current tick', () => {
    const busy = {
      ...base, tick: 10,
      instances: base.instances.map((i) => i.instance_id === 'cdn-1'
        ? { ...i, provisioning_until_tick: 16 } : i),
    }
    expect(boardOf(busy, c).find((b) => b.instance_id === 'cdn-1')!.provisioningTicksLeft)
      .toBe(6)
  })
})

describe('metricsOf', () => {
  it('returns all seven readings in dependency order', () => {
    expect(metricsOf(base, c).map((m) => m.id)).toEqual([...METRIC_IDS])
  })

  it('attaches previous and series from history', () => {
    const withHistory = { ...base, history: { p95_latency_ms: [60, 65, 70] } }
    const p95 = metricsOf(withHistory, c).find((m) => m.id === 'p95_latency_ms')!
    // value is the last history entry; previous is the entry before it.
    expect(p95.value).toBe(70)
    expect(p95.previous).toBe(65)
    expect(p95.series).toEqual([60, 65, 70])
  })

  it('omits previous when there is no history', () => {
    expect(metricsOf(base, c).find((m) => m.id === 'uptime_pct')!.previous).toBeUndefined()
  })

  it('round-trip: value matches history tail and previous is the entry before it', () => {
    // Advance past the scheduled incident so reputation has been decaying for
    // several ticks. This proves metricsOf reads history rather than re-deriving:
    // re-deriving would double-apply a tick of reputation decay, producing a
    // phantom future value that does not appear in state.carried or history.
    const s = advance(
      { ...loadScenario('slice-oom-kill', c), phase: 'run', rng_seed: 4242 } as GameState,
      20, c,
    )
    const readings = metricsOf(s, c)
    const rep = readings.find((m) => m.id === 'reputation')!
    const hist = s.history.reputation!
    // value must equal what the engine actually recorded — not a re-derivation
    expect(rep.value).toBe(s.carried.reputation)
    expect(rep.value).toBe(hist[hist.length - 1])
    // previous must be the entry before the tail, not the tail itself
    expect(rep.previous).toBe(hist[hist.length - 2])
  })
})

describe('statusOf', () => {
  const p95 = c.metricById.get('p95_latency_ms')!   // healthy [0, 200], lower_is_better
  const uptime = c.metricById.get('uptime_pct')!    // healthy [99.9, 100], higher_is_better

  it('is ok inside the healthy range', () => {
    expect(statusOf(120, p95)).toBe('ok')
    expect(statusOf(99.95, uptime)).toBe('ok')
  })

  it('is warn just outside and bad well outside', () => {
    expect(statusOf(260, p95)).toBe('warn')
    expect(statusOf(900, p95)).toBe('bad')
  })

  it('handles a higher_is_better metric breaching downward', () => {
    expect(statusOf(99.88, uptime)).toBe('warn')
    expect(statusOf(90, uptime)).toBe('bad')
  })
})

describe('nodeStatusOf', () => {
  const at = (over: Record<string, unknown>) =>
    nodeStatusOf({ ...base.instances[2], ...over } as any, c)

  it('is bad when down, regardless of health', () => {
    expect(at({ down: true, health: 100 })).toBe('bad')
  })

  it('is bad at zero health', () => {
    expect(at({ health: 0 })).toBe('bad')
  })

  it('is warn on low health or saturation', () => {
    expect(at({ health: 40 })).toBe('warn')
    expect(at({ utilization_pct: 85 })).toBe('warn')
  })

  it('is ok otherwise', () => {
    expect(at({})).toBe('ok')
  })
})

describe('boardOf — unknown def_id graceful degradation (T-c)', () => {
  // wave A made tierOf throw on an unresolvable tier. For an unknown def_id,
  // boardOf does NOT call tierOf — onRequestPath returns false early when the
  // definition is absent. So this path degrades rather than throwing.
  const ghost: NodeInstance = {
    instance_id: 'ghost-1', def_id: 'not_a_real_node',
    tier: 1, region: 'us-east-1a', health: 100, utilization_pct: 0,
    down: false, tags_runtime: [], action_cooldowns: {}, edges_out: [],
    provisioning_until_tick: null, created_tick: 0,
  }

  it('does not throw when an instance def_id is absent from the catalogue', () => {
    expect(() => boardOf({ ...base, instances: [ghost] }, c)).not.toThrow()
  })

  it("falls back to def_id for name and 'unknown' for layer", () => {
    const view = boardOf({ ...base, instances: [ghost] }, c)[0]
    expect(view.name).toBe('not_a_real_node')
    expect(view.layer).toBe('unknown')
  })

  it("nodeStatusOf returns 'unknown' for an absent def", () => {
    expect(nodeStatusOf(ghost, c)).toBe('unknown')
  })
})
