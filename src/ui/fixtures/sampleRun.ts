/* ============================================================================
   Sample runtime state for the gallery.
   ----------------------------------------------------------------------------
   DEFINITIONS come from the real data/ directory (see ../data/catalog.ts).
   Only the INSTANCE STATE here is fabricated, because instance state has no
   source in data/ by design — it is the other half of the two-layer rule and
   belongs to a save file the engine has not been written to produce yet.

   Action gating is NOT faked: this file imports `matchActions` from
   src/validate/matchActions.ts, the same predicate evaluator `npm run validate`
   uses. So which actions appear on which tier in the gallery is the real answer,
   not an approximation of it.
   ========================================================================== */

import { matchActions } from '../../validate/matchActions'
import type { Action as MatchAction, MatchInput } from '../../validate/matchActions'
import {
  actions, economy, index, instancesForSlot, isOnRequestPath, metrics,
  minigameInstances, nodes, tierOf,
} from '../data/catalog'
import type {
  ActionDef, ActiveIncident, BoardNode, Constraint, DebriefSummary, DesignSummary,
  IncidentDef, LedgerLine, MetricReading, MinigameSession, NodeInstance, PortFill,
  ResolvedAction, ResolvedSignal, ScenarioSummary, TagDef, TierLadderEntry,
} from '../types'
import {
  describeConstraint, healthStatus, metricStatus, ratio,
} from '../utils/format'

/* -------------------------------------------------- fabricated instances --- */

interface Seed {
  instance_id: string
  def_id: string
  tier: number
  health: number
  utilization_pct: number
  down?: boolean
  tags_runtime?: string[]
  edges_out?: string[]
  cooldowns?: Record<string, number>
  incidents?: string[]
  provisioningUntil?: number | null
}

const TICK = 412

/**
 * A mid-run board: a data-layer node has failed outright, compute is saturated
 * with no autoscaling, the cache is cold, and the worker pool was never wired to
 * a queue. Chosen so every component state the library can render is present.
 */
const SEEDS: Seed[] = [
  { instance_id: 'dns-root', def_id: 'dns', tier: 3, health: 100, utilization_pct: 12 },
  { instance_id: 'cdn-edge', def_id: 'cdn', tier: 2, health: 96, utilization_pct: 38, edges_out: ['lb-main'] },
  { instance_id: 'lb-main', def_id: 'load_balancer', tier: 2, health: 92, utilization_pct: 41, edges_out: ['app-us-01'] },
  {
    instance_id: 'app-us-01',
    def_id: 'app_cluster',
    tier: 2,
    health: 58,
    utilization_pct: 97,
    edges_out: ['pg-primary', 'redis-cache'],
    cooldowns: { restart: 34 },
  },
  { instance_id: 'worker-01', def_id: 'worker_pool', tier: 1, health: 88, utilization_pct: 22 },
  {
    instance_id: 'pg-primary',
    def_id: 'postgres',
    tier: 1,
    health: 0,
    utilization_pct: 0,
    down: true,
    incidents: ['hardware_failure'],
  },
  {
    instance_id: 'redis-cache',
    def_id: 'redis',
    tier: 2,
    health: 71,
    utilization_pct: 64,
    tags_runtime: ['cold_cache'],
  },
  { instance_id: 'mq-main', def_id: 'message_queue', tier: 1, health: 94, utilization_pct: 31 },
  { instance_id: 'metrics-01', def_id: 'metrics_pipeline', tier: 1, health: 100, utilization_pct: 18 },
  { instance_id: 'alerts-01', def_id: 'alerting', tier: 2, health: 100, utilization_pct: 9 },
  { instance_id: 'ci-01', def_id: 'ci_cd', tier: 2, health: 100, utilization_pct: 26, provisioningUntil: TICK + 3 },
  { instance_id: 'backup-01', def_id: 'backup_system', tier: 1, health: 100, utilization_pct: 4 },
]

export const sampleInstances: NodeInstance[] = SEEDS.map((seed) => ({
  instance_id: seed.instance_id,
  def_id: seed.def_id,
  tier: seed.tier,
  region: 'us-east-1a',
  health: seed.health,
  utilization_pct: seed.utilization_pct,
  down: seed.down ?? false,
  tags_runtime: seed.tags_runtime ?? [],
  action_cooldowns: seed.cooldowns ?? {},
  active_incidents: seed.incidents ?? [],
  edges_out: seed.edges_out ?? [],
  provisioning_until_tick: seed.provisioningUntil ?? null,
  created_tick: 0,
}))

/* ------------------------------------------------------- view model build --- */

function tagsFor(defTags: readonly string[], runtime: readonly string[]): TagDef[] {
  return [...defTags, ...runtime]
    .map((id) => index.tagById.get(id))
    .filter((t): t is TagDef => Boolean(t))
}

export function toBoardNode(inst: NodeInstance): BoardNode | null {
  const def = index.nodeById.get(inst.def_id)
  if (!def) return null
  const tier = tierOf(def, inst.tier)
  const layer = index.layerById.get(def.layer)
  if (!tier || !layer) return null

  return {
    def,
    tier,
    layer,
    inst,
    tags: tagsFor(tier.tags, inst.tags_runtime),
    status: healthStatus(inst.health, inst.down),
    onRequestPath: isOnRequestPath(def, tier.tags),
    edgesOut: inst.edges_out,
    provisioningTicksLeft:
      inst.provisioning_until_tick === null ? null : Math.max(0, inst.provisioning_until_tick - TICK),
  }
}

export const sampleBoard: BoardNode[] = sampleInstances
  .map(toBoardNode)
  .filter((n): n is BoardNode => n !== null)

export function boardNode(instanceId: string): BoardNode {
  const found = sampleBoard.find((n) => n.inst.instance_id === instanceId)
  if (!found) throw new Error(`fixture board has no instance ${instanceId}`)
  return found
}

/* ------------------------------------------------------ resolved actions --- */

/** Real gating: the same predicate evaluator the validator uses. */
export function resolvedActionsFor(node: BoardNode): ResolvedAction[] {
  const input: MatchInput = {
    layer: node.def.layer,
    role: node.def.role,
    node_id: node.def.id,
    tier: node.inst.tier,
    health: node.inst.health,
    tags: [...node.tier.tags, ...node.inst.tags_runtime],
    actions_extra: node.tier.actions_extra ? [...node.tier.actions_extra] : undefined,
    actions_deny: node.tier.actions_deny ? [...node.tier.actions_deny] : undefined,
  }

  const matchedIds = matchActions(
    input,
    actions.map((a) => ({ id: a.id, constraint: a.constraint as MatchAction['constraint'] })),
  )

  const resolving = new Set(
    node.inst.active_incidents.flatMap((id) => index.incidentById.get(id)?.resolved_by ?? []),
  )

  return matchedIds
    .map((id) => index.actionById.get(id))
    .filter((def): def is ActionDef => Boolean(def))
    .map((def): ResolvedAction | null => {
      const minigame = index.minigameById.get(def.minigame)
      if (!minigame) return null
      const cooldown = node.inst.action_cooldowns[def.id] ?? 0
      const emergency = node.inst.down || node.inst.health < 25
      const effectiveMoneyCost = emergency
        ? Math.round(def.money_cost * economy.emergency_premium_multiplier)
        : def.money_cost

      let availability: ResolvedAction['availability'] = 'ready'
      let blockedReason: string | undefined
      if (cooldown > 0) {
        availability = 'cooldown'
        blockedReason = `on cooldown for ${Math.round(cooldown)}s`
      } else if (node.provisioningTicksLeft) {
        availability = 'provisioning'
        blockedReason = 'node is still provisioning'
      }

      return {
        def,
        minigame,
        availability,
        cooldownRemainingS: cooldown,
        blockedReason,
        effectiveMoneyCost,
        resolvesActiveIncident: resolving.has(def.id),
        fromActionsExtra: Boolean(node.tier.actions_extra?.includes(def.id)),
      }
    })
    .filter((a): a is ResolvedAction => a !== null)
}

/* ---------------------------------------------------------- tier ladder ---- */

export function ladderFor(node: BoardNode): TierLadderEntry[] {
  const current = node.tier.stats.cost_month
  return node.def.tiers.map((tier) => ({
    tier,
    isCurrent: tier.tier === node.inst.tier,
    costDelta: tier.stats.cost_month - current,
    locked: tier.tier > node.inst.tier + 1,
  }))
}

/* ----------------------------------------------------------------- ports ---- */

export function portsFor(node: BoardNode): PortFill[] {
  const byId = new Map(sampleBoard.map((n) => [n.inst.instance_id, n]))
  return node.def.requires.map((port) => {
    const filled = node.inst.edges_out.filter((targetId) => {
      const target = byId.get(targetId)
      return target ? target.def.provides.some((cap) => port.accepts.includes(cap)) : false
    })
    return {
      port,
      filled,
      satisfied: filled.length >= port.min && filled.length <= port.max,
    }
  })
}

/* ------------------------------------------------------------- incidents ---- */

/** Evaluates a signal's `requires` against the observability actually on the board. */
function observabilitySatisfied(requires: Constraint | null): boolean {
  if (!requires) return true
  const ids = requires.node_ids
  if (!ids?.length) return true
  return sampleBoard.some(
    (n) =>
      ids.includes(n.def.id) &&
      (requires.min_tier === undefined || n.inst.tier >= requires.min_tier) &&
      !n.inst.down,
  )
}

function resolveSignals(def: IncidentDef): ResolvedSignal[] {
  return def.signals.map((signal) => ({
    level: signal.level,
    text: signal.text,
    // Level 0 is always visible by authoring rule; its `requires` is null.
    unlocked: signal.level === 0 || observabilitySatisfied(signal.requires),
    requires: signal.requires,
    requirementLabel: signal.requires
      ? describeConstraint(signal.requires, (id) => index.nodeById.get(id)?.name ?? id)
      : undefined,
  }))
}

function pickIncident(preferred: string, fallbackIndex: number): IncidentDef {
  return index.incidentById.get(preferred) ?? (catalogIncident(fallbackIndex) as IncidentDef)
}

function catalogIncident(i: number): IncidentDef | undefined {
  return [...index.incidentById.values()][i]
}

const primary = pickIncident('hardware_failure', 0)
const secondary = pickIncident('cache_eviction_storm', 1)

export const sampleIncidents: ActiveIncident[] = [primary, secondary]
  .filter((d, i, arr): d is IncidentDef => Boolean(d) && arr.indexOf(d) === i)
  .map((def, i) => ({
    def,
    key: `${def.id}#1`,
    affectedInstanceIds:
      def.scope === 'architecture' ? [] : i === 0 ? ['pg-primary'] : ['redis-cache'],
    elapsedTicks: i === 0 ? 44 : 12,
    ticksRemaining: def.duration_ticks,
    ticksToEscalation: def.escalate_after_ticks
      ? Math.max(0, def.escalate_after_ticks - (i === 0 ? 44 : 12))
      : null,
    signals: resolveSignals(def),
    resolvingActions: def.resolved_by
      .map((id) => index.actionById.get(id))
      .filter((a): a is ActionDef => Boolean(a)),
  }))

export const incidentCountByInstance: Record<string, number> = sampleIncidents.reduce(
  (acc, inc) => {
    for (const id of inc.affectedInstanceIds) acc[id] = (acc[id] ?? 0) + 1
    return acc
  },
  {} as Record<string, number>,
)

/* --------------------------------------------------------------- metrics ---- */

const VALUES: Record<string, number> = {
  uptime_pct: 99.14,
  p95_latency_ms: 486,
  error_rate_pct: 3.1,
  reputation: 68,
  users: 128_400,
  cost_month: 6_240,
  profit_month: 6_600,
}

const PREVIOUS: Record<string, number> = {
  uptime_pct: 99.63,
  p95_latency_ms: 402,
  error_rate_pct: 1.4,
  reputation: 71,
  users: 129_100,
  cost_month: 6_240,
  profit_month: 6_670,
}

/** A short history that trends toward the current value, for the sparklines. */
function series(id: string): number[] {
  const to = VALUES[id]
  const from = PREVIOUS[id]
  return Array.from({ length: 12 }, (_, i) => {
    const t = ratio(i, 0, 11)
    const wobble = Math.sin(i * 1.7) * Math.abs(to - from) * 0.12
    return from + (to - from) * t + wobble
  })
}

export const sampleMetrics: MetricReading[] = metrics.map((def) => ({
  def,
  value: VALUES[def.id] ?? 0,
  previous: PREVIOUS[def.id],
  series: series(def.id),
  status: metricStatus(VALUES[def.id] ?? 0, def),
}))

/* ---------------------------------------------- design / debrief / scenarios */

export const sampleDesignSummary: DesignSummary = {
  budget: 340,
  spent: 460,
  projected: sampleMetrics.filter((m) =>
    ['uptime_pct', 'p95_latency_ms', 'cost_month', 'profit_month'].includes(m.def.id),
  ),
  exposedWeaknesses: sampleBoard
    .flatMap((n) => n.tags)
    .filter((t) => t.kind === 'weakness')
    .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i),
  unsatisfiedPorts: sampleBoard.flatMap((node) =>
    portsFor(node)
      .filter((p) => !p.satisfied && p.port.min > 0)
      .map((port) => ({ node, port })),
  ),
}

export const sampleLedger: LedgerLine[] = [
  { kind: 'provision', amount: -120, tick: 0, label: 'pg-primary tier 1' },
  { kind: 'provision', amount: -340, tick: 0, label: 'app-us-01 tier 2' },
  { kind: 'sla_credit', amount: -188, tick: 372, label: 'hardware_failure · per tick' },
  { kind: 'emergency_premium', amount: -150, tick: 380, label: 'add_replica under incident' },
  { kind: 'data_egress', amount: -42, tick: 400, label: 'cdn-edge overage' },
  { kind: 'incident_remediation', amount: -360, tick: 410, label: 'hardware_failure' },
]

export const sampleDebrief: DebriefSummary = {
  scenarioName: 'The First Nine',
  cleared: false,
  ticks: TICK,
  finalMetrics: sampleMetrics,
  incidentsFaced: sampleIncidents.map((i, n) => ({ def: i.def, resolved: n !== 0 })),
  lessons: minigameInstances.slice(0, 4).map((i) => ({ instanceId: i.id, teaches: i.teaches })),
  ledger: sampleLedger,
}

export const sampleScenarios: ScenarioSummary[] = [
  {
    id: 'first-nine',
    name: 'The First Nine',
    blurb: 'Serve 10,000 users at 99.9% for a month on a starter budget. One database, no replica.',
    locked: false,
    stars: 3,
    startingBudget: economy.starting_budget,
    allowedLayers: ['edge', 'ingress', 'compute', 'data'],
  },
  {
    id: 'black-friday',
    name: 'Black Friday',
    blurb: 'Traffic multiplies by eight in an hour. Your autoscaling has never been tested.',
    locked: false,
    stars: 1,
    startingBudget: 2400,
    allowedLayers: ['edge', 'ingress', 'compute', 'data', 'observability'],
  },
  {
    id: 'blast-radius',
    name: 'Blast Radius',
    blurb: 'A whole region goes dark. Nothing you do brings it back — only what you built before.',
    locked: true,
    stars: 0,
    startingBudget: 5200,
    allowedLayers: ['edge', 'ingress', 'compute', 'data', 'reliability', 'observability', 'delivery'],
  },
]

/* ------------------------------------------------------ minigame sessions --- */

/** The first action in the catalog that invokes a given minigame. */
function actionFor(minigameId: string, difficulty: number): ActionDef | undefined {
  return (
    actions.find((a) => a.minigame === minigameId && a.difficulty === difficulty) ??
    actions.find((a) => a.minigame === minigameId)
  )
}

/** One real instance per format, with the action that actually invokes it. */
export function sampleSession(formatId: string, attempt = 1): MinigameSession | null {
  const minigame = [...index.minigameById.values()].find((m) => m.format === formatId)
  if (!minigame) return null

  const slot = actions
    .filter((a) => a.minigame === minigame.id)
    .map((a) => a.difficulty)
    .find((d) => instancesForSlot(minigame.id, d).length > 0)
  if (slot === undefined) return null

  const instance = instancesForSlot(minigame.id, slot)[0]
  const action = actionFor(minigame.id, slot)
  const format = index.formatById.get(minigame.format)
  if (!instance || !action || !format) return null

  return {
    instance,
    minigame,
    format,
    action,
    attempt,
    revealed: attempt > 3,
    answer: blankAnswer(formatId, instance),
  }
}

function blankAnswer(
  formatId: string,
  instance: (typeof minigameInstances)[number],
): MinigameSession['answer'] {
  switch (formatId) {
    case 'ordered_sequence': {
      const given = instance.given as { steps: string[] }
      return { kind: 'ordered_sequence', order: given.steps.map((_, i) => i) }
    }
    case 'fill_blank':
      return { kind: 'fill_blank', blanks: {} }
    case 'dial': {
      const given = instance.given as { range: { min: number; max: number } }
      return { kind: 'dial', value: given.range.min }
    }
    case 'wiring':
      return { kind: 'wiring', zone: null, connectTo: [] }
    default:
      return { kind: 'evidence', choice: null }
  }
}

export const sampleSessions = ['ordered_sequence', 'fill_blank', 'dial', 'wiring', 'evidence']
  .map((f) => sampleSession(f))
  .filter((s): s is MinigameSession => s !== null)

/* ----------------------------------------------------------------- palette --- */

export const samplePaletteEntries = sampleBoard.flatMap((node) =>
  resolvedActionsFor(node).map((action) => ({ action, node })),
)

export const placedCounts: Record<string, number> = sampleInstances.reduce((acc, i) => {
  acc[i.def_id] = (acc[i.def_id] ?? 0) + 1
  return acc
}, {} as Record<string, number>)

export const sampleTick = TICK
export const allNodeDefs = nodes
