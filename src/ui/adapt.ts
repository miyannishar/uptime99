/* adapt.ts — translates engine view models → UI view models.
   Engine outputs are flat and serialisable (id strings, not resolved objects).
   This layer resolves them using the frozen engineCatalog.
   It is typed on both ends, so TypeScript fails here if either side's shape drifts.

   TYPE MISMATCHES BETWEEN ENGINE AND UI — see report at .superpowers/sdd/ui-wiring/adapt-report.md
   ─────────────────────────────────────────────────────────────────────────────────
   1. BoardNode.inst — The UI type `BoardNode` carries `inst: NodeInstance` rather
      than the flat fields BoardNodeView exposes (health, region, down, …). The engine
      NodeInstance (from @engine/types) also lacks `active_incidents`, which the UI
      NodeInstance requires. adaptBoardNode therefore accepts the full GameState as a
      second argument to look up the real engine NodeInstance and derive
      active_incidents from state.incidents. The resulting inst is cast `as any` where
      the two NodeInstance types diverge.
   2. BoardNode has no x / y / healthStatus / utilStatus — these are present in
      BoardNodeView but absent from the UI's BoardNode interface. They are dropped.
   3. PortFillView → PortFill adaptation is not yet required; port: string → PortDef
      resolution will be needed if any component renders port fills. */

import type { BoardNodeView, GameState, MetricReadingView } from '@engine/types'
import type { IncidentRecord } from '@engine/types'
import type { EngineCatalog } from '@engine/catalogFrom'
import { engineCatalog } from './data/catalog'
import type { ActiveIncident, BoardNode, MetricReading } from './types'

/** Resolve a flat BoardNodeView into the richer BoardNode the UI components use.
 *  Pass the engine GameState so that inst.active_incidents can be derived from
 *  state.incidents and the remaining NodeInstance fields come from state.instances. */
export function adaptBoardNode(
  view: BoardNodeView,
  state: GameState | null,
  catalog: EngineCatalog = engineCatalog,
): BoardNode {
  const def = catalog.nodeById.get(view.def_id)
  if (!def) throw new Error(`adapt: unknown def_id '${view.def_id}'`)

  const tier = def.tiers.find((t: any) => t.tier === view.tier) ?? def.tiers[0]

  const layer = catalog.layerById.get(view.layer)
  if (!layer) throw new Error(`adapt: unknown layer '${view.layer}'`)

  const tags = view.tags
    .map((id) => catalog.tagById.get(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t)) as any[]

  // Look up the real engine NodeInstance from GameState so we can fill every
  // field of the UI NodeInstance precisely (action_cooldowns, tags_runtime, etc.)
  // TODO: field mismatch — active_incidents is in the UI NodeInstance but not in
  //       the engine NodeInstance. Derived here from state.incidents.
  const engineInst = state?.instances.find((i) => i.instance_id === view.instance_id)

  const activeIncidents: readonly string[] = state
    ? state.incidents
        .filter((r) => r.instance_id === view.instance_id)
        .map((r) => r.incident_id)
    : []

  // Construct the UI NodeInstance. The spread pulls every field from the engine
  // NodeInstance; we add active_incidents on top. Cast as `any` to bridge the two
  // NodeInstance types (different modules, different `active_incidents` requirement).
  // TODO: if engineInst is undefined (node was in the view but not in state.instances)
  //       we fall back to the flat fields from BoardNodeView; fields not present in
  //       the view (action_cooldowns, created_tick) are set to empty/zero defaults.
  const inst: BoardNode['inst'] = engineInst
    ? ({ ...engineInst, active_incidents: activeIncidents } as any)
    : ({
        instance_id: view.instance_id,
        def_id: view.def_id,
        tier: view.tier,
        region: view.region,
        health: view.health,
        utilization_pct: view.utilization_pct,
        down: view.down,
        tags_runtime: [],
        action_cooldowns: {},
        active_incidents: activeIncidents,
        edges_out: view.edgesOut,
        // TODO: only provisioningTicksLeft (derived) is in BoardNodeView; raw tick unknown
        provisioning_until_tick: null,
        // TODO: created_tick is not in BoardNodeView
        created_tick: 0,
      } as any)

  return {
    def,
    tier,
    layer,
    inst,
    tags,
    status: view.status,
    onRequestPath: view.onRequestPath,
    edgesOut: view.edgesOut,
    provisioningTicksLeft: view.provisioningTicksLeft,
  }
}

/** Resolve a MetricReadingView into the UI's MetricReading. */
export function adaptMetricReading(
  view: MetricReadingView,
  catalog: EngineCatalog = engineCatalog,
): MetricReading {
  const def = catalog.metricById.get(view.id)
  if (!def) throw new Error(`adapt: unknown metric '${view.id}'`)
  return {
    def,
    value: view.value,
    previous: view.previous,
    series: view.series ? [...view.series] : undefined,
    status: view.status,
  }
}

/** Adapt a batch of BoardNodeViews. */
export function adaptBoard(
  views: readonly BoardNodeView[],
  state: GameState | null = null,
  catalog: EngineCatalog = engineCatalog,
): BoardNode[] {
  return views.map((v) => adaptBoardNode(v, state, catalog))
}

/** Adapt all metric readings. */
export function adaptMetrics(
  views: readonly MetricReadingView[],
  catalog: EngineCatalog = engineCatalog,
): MetricReading[] {
  return views.map((v) => adaptMetricReading(v, catalog))
}

/** Translate engine IncidentRecords into the UI's ActiveIncident shape.
 *  Signals, resolvingActions, and per-definition fields require the engine
 *  catalog; timing fields are derived from the record and current tick.
 *
 *  NOTE: `signals` and `resolvingActions` are stubbed empty until `signalsFor`
 *  and `actionsFor` are built in the engine (Plan B). */
export function adaptIncidents(
  records: readonly IncidentRecord[],
  tick: number,
  catalog: EngineCatalog = engineCatalog,
): ActiveIncident[] {
  // Group records by key so each key becomes one ActiveIncident.
  const groups = new Map<string, IncidentRecord[]>()
  for (const r of records) {
    const g = groups.get(r.key) ?? []
    g.push(r)
    groups.set(r.key, g)
  }

  const result: ActiveIncident[] = []
  for (const [key, recs] of groups) {
    const rep = recs[0]
    const def = catalog.incidentById.get(rep.incident_id)
    if (!def) continue

    const affectedInstanceIds = recs
      .map((r) => r.instance_id)
      .filter((id): id is string => id !== null)

    const elapsedTicks = tick - rep.started_tick
    const ticksRemaining = rep.expires_at_tick !== null
      ? Math.max(0, rep.expires_at_tick - tick)
      : null
    const ticksToEscalation = rep.escalate_at_tick !== null
      ? Math.max(0, rep.escalate_at_tick - tick)
      : null

    const resolvingActions = ((def as any).resolved_by ?? [])
      .map((id: string) => catalog.actionById.get(id))
      .filter(Boolean)

    // Populate signals from the incident definition.
    // Level 0 is always visible (no observability required).
    // Levels 1–3 require specific observability nodes — always shown as locked for now
    // since signalsFor() (which checks the board) isn't built yet.
    const signals = ((def as any).signals ?? []).map((sig: any) => ({
      level: sig.level,
      text: sig.text,
      unlocked: sig.requires === null || sig.level === 0,
      requirementLabel: sig.requires
        ? Object.entries(sig.requires as Record<string, any>)
            .flatMap(([k, v]) => Array.isArray(v) ? v.map(String) : [`${k}: ${v}`])
            .join(', ')
        : undefined,
    }))

    result.push({
      def,
      key,
      affectedInstanceIds,
      elapsedTicks,
      ticksRemaining,
      ticksToEscalation,
      signals,
      resolvingActions,
    })
  }
  return result
}

/** Count active incidents per instance_id, for badge rendering on the board. */
export function incidentCountByInstanceFrom(
  records: readonly IncidentRecord[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  // Group by key first so one group-scope incident doesn't count N times per node
  const seen = new Set<string>()
  for (const r of records) {
    if (!r.instance_id) continue
    const dedup = `${r.key}::${r.instance_id}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    counts[r.instance_id] = (counts[r.instance_id] ?? 0) + 1
  }
  return counts
}

/** Translate engine ScenarioDef + earned-stars map to the UI's ScenarioSummary. */
export function adaptScenario(
  def: import('@engine/types').ScenarioDef,
  earnedStars: Record<string, number> = {},
  unlockedIds: Set<string> = new Set(['slice-oom-kill']),
): import('./types').ScenarioSummary {
  return {
    id: def.id,
    name: def.name,
    blurb: def.blurb,
    locked: !unlockedIds.has(def.id),
    stars: earnedStars[def.id] ?? 0,
    startingBudget: def.starting_budget,
    allowedLayers: def.allowed_layers as any[],
  }
}

/**
 * Build the scenario list with correct unlock state.
 * `completedIds` is the set of scenario ids the player has finished (from a
 * persistent progress store; defaults to empty so only starter scenarios show).
 * A scenario is unlocked when every id in its `unlocked_by` list is completed,
 * OR when its own `unlocked_by` is empty (starter scenarios).
 */
export function adaptScenarios(
  catalog: EngineCatalog = engineCatalog,
  earnedStars: Record<string, number> = {},
  completedIds: Set<string> = new Set(),
): import('./types').ScenarioSummary[] {
  const scenarios = catalog.scenarios as any[]
  // A scenario is unlocked if ALL its prerequisites are in completedIds
  const unlocked = new Set(
    scenarios
      .filter((s) =>
        !s.unlocked_by || (s.unlocked_by as string[]).length === 0 ||
        (s.unlocked_by as string[]).every((req: string) => completedIds.has(req))
      )
      .map((s) => s.id)
  )
  return (scenarios as import('@engine/types').ScenarioDef[]).map((def) =>
    adaptScenario(def, earnedStars, unlocked),
  )
}

/** Translate a flat ResolvedActionView into the UI's ResolvedAction (with resolved defs). */
export function adaptAction(
  view: import('@engine/actions').ResolvedActionView,
  catalog: EngineCatalog = engineCatalog,
): import('./types').ResolvedAction | null {
  const def = catalog.actionById.get(view.action_id)
  if (!def) return null
  const minigame = catalog.minigames.find((m: any) => m.id === (def as any).minigame) as any
  if (!minigame) return null
  return {
    def,
    minigame,
    availability: view.availability,
    cooldownRemainingS: view.cooldownRemainingS,
    blockedReason: view.blockedReason,
    effectiveMoneyCost: view.effectiveMoneyCost,
    resolvesActiveIncident: view.resolvesActiveIncident,
    fromActionsExtra: view.fromActionsExtra,
  } as any
}

export function adaptActions(
  views: import('@engine/actions').ResolvedActionView[],
  catalog: EngineCatalog = engineCatalog,
): import('./types').ResolvedAction[] {
  return views.map(v => adaptAction(v, catalog)).filter(Boolean) as any[]
}

/** Translate a flat TierLadderView into the UI's TierLadderEntry (with resolved TierDef). */
export function adaptTierLadder(
  views: import('@engine/actions').TierLadderView[],
  defId: string,
  catalog: EngineCatalog = engineCatalog,
): import('./types').TierLadderEntry[] {
  const def = catalog.nodeById.get(defId) as any
  if (!def) return []
  return views.map(v => {
    const tierDef = def.tiers.find((t: any) => t.tier === v.tier_number)
    if (!tierDef) return null
    return {
      tier: tierDef,
      isCurrent: v.isCurrent,
      costDelta: v.costDelta,
      locked: v.locked,
    }
  }).filter(Boolean) as any[]
}

/** Translate the engine's DesignSummaryView into the UI's DesignSummary.
 *  Needs the full game state to compute projected metrics and board context. */
export function adaptDesignSummary(
  view: import('@engine/summary').DesignSummaryView,
  board: import('./types').BoardNode[],
  projectedMetrics: import('./types').MetricReading[],
  catalog: EngineCatalog = engineCatalog,
): import('./types').DesignSummary {
  const boardById = new Map(board.map(n => [n.inst.instance_id, n]))

  const unsatisfiedPorts = view.unsatisfiedPorts.map(u => {
    const node = boardById.get(u.instance_id)
    if (!node) return null
    const portDef = node.def.requires.find((p: any) => p.port === u.port)
    if (!portDef) return null
    const filled = node.inst.edges_out.filter((targetId: string) => {
      const target = boardById.get(targetId)
      return target ? target.def.provides.some((cap: string) => portDef.accepts.includes(cap)) : false
    })
    return {
      node,
      port: { port: portDef, filled, satisfied: false },
    }
  }).filter(Boolean) as any[]

  const exposedWeaknesses = view.exposedWeaknessIds
    .map(id => catalog.tagById.get(id))
    .filter(Boolean) as any[]

  return {
    budget: view.budget,
    spent: view.spent,
    projected: projectedMetrics,
    exposedWeaknesses,
    unsatisfiedPorts,
  }
}

/** Build the debrief summary from the engine view + final metric readings. */
export function adaptDebriefSummary(
  view: import('@engine/summary').DebriefSummaryView,
  finalMetricViews: import('@engine/types').MetricReadingView[] = [],
  catalog: EngineCatalog = engineCatalog,
): import('./types').DebriefSummary {
  const finalMetrics = adaptMetrics(finalMetricViews, catalog)

  // incidentsFaced: resolve from the ledger's on_resolve entries (what was resolved)
  // and track which incident defs actually fired based on the ledger
  // For now: show how many incidents fired and resolved from session state
  const incidentsFaced: import('./types').DebriefSummary['incidentsFaced'] = []

  // Lessons: gather teaches from any minigame instances that were played
  // (tracked via IncidentRecord.attempts — each key is a minigame instance id with a count)
  const lessons: import('./types').DebriefSummary['lessons'] = []

  return {
    scenarioName: view.scenario_name,
    cleared: view.cleared,
    ticks: view.ticks,
    finalMetrics,
    incidentsFaced,
    lessons,
    ledger: adaptLedger(view.ledger, catalog),
  }
}

/** Translate engine LedgerEntry to the UI's LedgerLine. */
export function adaptLedger(
  entries: readonly import('@engine/types').LedgerEntry[],
  catalog: EngineCatalog = engineCatalog,
): import('./types').LedgerLine[] {
  return entries.map(e => {
    // Build a human-readable label: incident/action name or instance name
    let label = e.kind
    if (e.instance_id) {
      const inst_def_id = e.instance_id.replace(/-\d+$/, '').replace(/-/g, '_')
      const def = catalog.nodeById.get(inst_def_id)
      if (def) label = (def as any).name + ' · ' + e.kind
    }
    return {
      kind: e.kind as any,
      amount: e.amount,
      tick: e.tick,
      label,
      sourceId: e.instance_id ?? undefined,
    }
  })
}
