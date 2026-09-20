import type { EngineCatalog } from './catalog'
import { deriveMetrics, onRequestPath } from './metrics'
import { instanceIdFor } from './scenario'
import {
  METRIC_IDS, type BoardNodeView, type GameState, type MetricId, type MetricReadingView,
  type NodeInstance, type Status,
} from './types'

/** Engine-owned. The UI must not re-derive this; see handoff §5. */
export function statusOf(value: number, metricDef: any): Status {
  const [lo, hi] = metricDef.healthy_range as [number, number]
  if (value >= lo && value <= hi) return 'ok'
  const width = Math.max(1e-9, hi - lo)
  const overshoot = value > hi ? value - hi : lo - value
  return overshoot <= width * 0.5 ? 'warn' : 'bad'
}

export function nodeStatusOf(i: NodeInstance, catalog: EngineCatalog): Status {
  const def = catalog.nodeById.get(i.def_id)
  if (!def) return 'unknown'
  if (i.down || i.health <= 0) return 'bad'
  const knee = (catalog.economy.saturation_knee as number) * 100
  if (i.health < 60 || i.utilization_pct >= knee) return 'warn'
  return 'ok'
}

export function boardOf(state: GameState, catalog: EngineCatalog): BoardNodeView[] {
  const scenario = catalog.scenarioById.get(state.scenario_id)
  if (!scenario) throw new Error(`boardOf: unknown scenario '${state.scenario_id}'`)

  const positions = new Map<string, { x: number; y: number }>()
  const counts: Record<string, number> = {}
  for (const b of scenario.board) {
    counts[b.def_id] = (counts[b.def_id] ?? 0) + 1
    positions.set(instanceIdFor(b.def_id, counts[b.def_id]), { x: b.x, y: b.y })
  }

  return state.instances.map((i) => {
    const def = catalog.nodeById.get(i.def_id)
    const tier = def?.tiers.find((t: any) => t.tier === i.tier)
    const at = positions.get(i.instance_id) ?? { x: 0, y: 0 }
    return {
      instance_id: i.instance_id,
      def_id: i.def_id,
      name: def?.name ?? i.def_id,
      layer: def?.layer ?? 'unknown',
      tier: i.tier,
      region: i.region,
      health: i.health,
      utilization_pct: i.utilization_pct,
      down: i.down,
      status: nodeStatusOf(i, catalog),
      tags: [...(tier?.tags ?? []), ...i.tags_runtime],
      onRequestPath: onRequestPath(i, catalog),
      edgesOut: i.edges_out,
      provisioningTicksLeft: i.provisioning_until_tick === null
        ? null
        : Math.max(0, i.provisioning_until_tick - state.tick),
      x: at.x,
      y: at.y,
    }
  })
}

export function metricsOf(state: GameState, catalog: EngineCatalog): MetricReadingView[] {
  // History holds this tick's value (step 7 in tick.ts appended it last).
  // Reading from history avoids re-deriving, which would double-apply a tick of
  // decay to the recursive metrics (reputation, users, profit_month). For the
  // same reason, `previous` is the entry before the tail, not the tail itself.
  //
  // When history is empty — the design phase before any tick fires — fall back to
  // deriveMetrics for projected values. previous is undefined: no prior reading exists.
  let fallback: Record<MetricId, number> | undefined
  return METRIC_IDS.map((id) => {
    const def = catalog.metricById.get(id)!
    const series: readonly number[] = state.history[id] ?? []
    if (series.length > 0) {
      const value = series[series.length - 1]
      const previous = series.length >= 2 ? series[series.length - 2] : undefined
      return { id, value, previous, series, status: statusOf(value, def) }
    }
    // No history: project from current state (design phase).
    // Computed lazily and reused across the metric loop to avoid redundant work.
    if (!fallback) fallback = deriveMetrics(state, catalog)
    const value = fallback[id]
    return { id, value, previous: undefined, series: undefined, status: statusOf(value, def) }
  })
}
