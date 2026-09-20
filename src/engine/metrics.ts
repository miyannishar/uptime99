import { evaluateFormula, type FormulaScope } from './formula'
import type { EngineCatalog } from './catalog'
import { METRIC_IDS, type GameState, type MetricId, type NodeInstance } from './types'

export const SECONDS_PER_MONTH = 2_592_000

/**
 * Look up the tier definition for an instance. Throws rather than returning
 * undefined: a missing def or an unmatched tier number means the save references
 * a non-existent tier, which would silently contribute zero to every metric
 * (blast_radius, latency, cost) instead of failing loudly. (M10)
 */
function tierOf(i: NodeInstance, catalog: EngineCatalog): any {
  const def = catalog.nodeById.get(i.def_id)
  if (!def) throw new Error(`metrics: unknown node definition '${i.def_id}'`)
  const tier = def.tiers.find((t: any) => t.tier === i.tier)
  if (!tier) throw new Error(`metrics: node '${i.def_id}' has no tier ${i.tier}`)
  return tier
}

/** CLAUDE.md §10: on-path layer AND the tier carries neither async nor scheduled. */
export function onRequestPath(i: NodeInstance, catalog: EngineCatalog): boolean {
  const def = catalog.nodeById.get(i.def_id)
  if (!def) return false
  const layer = catalog.layerById.get(def.layer)
  if (!layer?.on_request_path) return false
  const tags: string[] = tierOf(i, catalog).tags ?? []
  return !tags.includes('async') && !tags.includes('scheduled')
}

function healthy(catalog: EngineCatalog, id: MetricId): [number, number] {
  return catalog.metricById.get(id)!.healthy_range as [number, number]
}

export function buildScope(
  state: GameState, catalog: EngineCatalog, computed: Partial<Record<MetricId, number>>,
): FormulaScope {
  const e = catalog.economy
  const ticksPerMonth = SECONDS_PER_MONTH / e.tick_seconds

  const path = state.instances.filter((i) => onRequestPath(i, catalog))
  // A board with no on-path nodes is a misconfigured save: every path-dependent
  // metric (p95, error_rate) would silently report a perfect score. (M3)
  if (path.length === 0) {
    throw new Error('metrics: no on-path nodes in state — cannot derive p95 or error_rate')
  }
  const vec = (xs: readonly NodeInstance[], f: (i: NodeInstance) => number) => xs.map(f)

  // incident_severity is not stored anywhere: it is the sum over active
  // incidents each tick (CLAUDE.md §13). Deduplicated by incident key so a
  // group-scope incident spanning three nodes counts once.
  const seenKeys = new Set<string>()
  let incidentSeverity = 0
  for (const r of state.incidents) {
    if (seenKeys.has(r.key)) continue
    seenKeys.add(r.key)
    incidentSeverity += catalog.incidentById.get(r.incident_id)?.severity ?? 0
  }

  const uptime = computed.uptime_pct ?? 100
  const p95 = computed.p95_latency_ms ?? 0

  // Rule: a metric's own formula sees its previous (carried) value; every
  // downstream metric in the pipeline sees the freshly computed value. (I1)
  // Both reputation and users follow this rule explicitly — object-literal
  // ordering must not be what decides precedence for either.
  const reputation = computed.reputation ?? state.carried.reputation
  const users = computed.users ?? state.carried.users

  const scalars: Record<string, number> = {
    ...Object.fromEntries(
      Object.entries(e).filter(([, v]) => typeof v === 'number') as [string, number][]),
    ...computed,
    users,
    reputation,
    incident_severity: incidentSeverity,
    ticks_per_month: ticksPerMonth,
    reputation_growth:
      (e.reputation_growth_rate * (reputation / 100)) / ticksPerMonth,
    latency_churn:
      (e.latency_churn_rate * Math.max(0, p95 - healthy(catalog, 'p95_latency_ms')[1]) / 100)
      / ticksPerMonth,
    outage_churn:
      (e.outage_churn_rate * Math.max(0, healthy(catalog, 'uptime_pct')[0] - uptime))
      / ticksPerMonth,
  }

  const recurring = state.ledger
    .filter((l) => l.cadence === 'monthly')
    // amount is negative by convention (a charge); cost_month is a positive cost,
    // so we negate: a charge must add to cost, not subtract from it.
    .map((l) => -l.amount)

  return {
    scalars,
    vectors: {
      'node.blast_radius': vec(state.instances, (i) => tierOf(i, catalog).stats.blast_radius),
      'node.down': vec(state.instances, (i) => (i.down ? 1 : 0)),
      'node.health': vec(state.instances, (i) => i.health),
      'node.utilization_pct': vec(state.instances, (i) => i.utilization_pct),
      'path.base_latency_ms': vec(path, (i) => tierOf(i, catalog).stats.base_latency_ms),
      'path.utilization_pct': vec(path, (i) => i.utilization_pct),
      'instance.cost_month': vec(state.instances, (i) => tierOf(i, catalog).stats.cost_month),
      // usage_cost requires metered traffic data not yet built
      'instance.usage_cost': [],
      'ledger.recurring': recurring,
    },
  }
}

/**
 * Evaluate all seven metrics in METRIC_IDS order, which is a valid topological
 * order: each formula may only read metrics already computed.
 */
export function deriveMetrics(
  state: GameState, catalog: EngineCatalog,
): Record<MetricId, number> {
  const out: Partial<Record<MetricId, number>> = {}
  for (const id of METRIC_IDS) {
    const def = catalog.metricById.get(id)
    if (!def?.formula) throw new Error(`metrics: '${id}' has no formula`)
    out[id] = evaluateFormula(def.formula, buildScope(state, catalog, out))
  }
  return out as Record<MetricId, number>
}
