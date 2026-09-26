/* ============================================================================
   Runtime types - per-save instance state, plus the view models components take.
   ----------------------------------------------------------------------------
   Two distinct things live here:

   1. `NodeInstance` / `GameState` - a 1:1 mirror of data/schema/state.schema.json.
      This is the mutable half of the two-layer rule (CLAUDE.md §2).

   2. View models (`BoardNode`, `ResolvedAction`, `ResolvedSignal`, ...) - the
      shapes components actually accept. Every one pairs a definition with the
      instance state that varies, so a component never has to resolve a def_id,
      evaluate a constraint predicate, or compute a cooldown itself. That work
      belongs to the engine; these types are the seam between the two, which is
      what makes the components attachable later with no rework.
   ========================================================================== */

import type {
  ActionDef, Constraint, FormatDef, IncidentDef, LayerDef, LayerId,
  LedgerEventKind, MetricDef, MinigameDef, MinigameInstanceDef, NodeDef,
  PortDef, SignalLevel, TagDef, TierDef, WrongOutcome,
} from './definitions'

/* ------------------------------------------------- instance state (exact) --- */

/** Mirrors state.schema.json `instances[]`. All 13 fields are required there. */
export interface NodeInstance {
  /** `^[a-z][a-z0-9-]*$` - e.g. `app-us-01`. Distinct from `def_id`. */
  readonly instance_id: string
  /** `^[a-z][a-z0-9_]*$` - the NodeDef id this instance is built from. */
  readonly def_id: string
  /** 1–4. */
  readonly tier: number
  readonly region: string
  /** 0-100. `health: 0` means up but failing under load - not the same as `down`. */
  readonly health: number
  /** May exceed 100; that is what drives error_rate_pct. */
  readonly utilization_pct: number
  /** Unreachable. `uptime_pct` reads this, NOT `health`. */
  readonly down: boolean
  /** Tags applied by incidents, e.g. `cold_cache`. Never in a definition. */
  readonly tags_runtime: readonly string[]
  /** action id -> seconds remaining. */
  readonly action_cooldowns: Readonly<Record<string, number>>
  readonly active_incidents: readonly string[]
  /** instance_ids this instance sends traffic to. */
  readonly edges_out: readonly string[]
  readonly provisioning_until_tick: number | null
  readonly created_tick: number
}

export interface GameState {
  readonly instances: readonly NodeInstance[]
}

/* --------------------------------------------------------- status buckets --- */

/** Shared visual bucket. Derived, never authored. */
export type Status = 'ok' | 'warn' | 'bad' | 'unknown'

/** Why an action cannot be played right now. */
export type ActionAvailability =
  | 'ready'
  | 'cooldown'
  | 'unaffordable'
  | 'provisioning'
  | 'constraint'

export type PhaseId = 'design' | 'run' | 'debrief'

/* ------------------------------------------------------------- board node --- */

/**
 * One node on the board: its definition, the tier it is currently at, its
 * layer, and its live instance state. `tier` is resolved from `inst.tier`
 * by the caller so components never index `def.tiers` themselves.
 */
export interface BoardNode {
  readonly def: NodeDef
  readonly tier: TierDef
  readonly layer: LayerDef
  readonly inst: NodeInstance
  /** Definition tags plus `inst.tags_runtime`, resolved to TagDefs. */
  readonly tags: readonly TagDef[]
  /** Derived from health / down / utilization_pct. */
  readonly status: Status
  /**
   * True when this node contributes to the p95 sum: its layer has
   * `on_request_path` AND the tier carries neither `async` nor `scheduled`.
   * Resolved by the caller - layers.json is the single source of truth for
   * this and there is deliberately no per-node tag for it (CLAUDE.md §10).
   */
  readonly onRequestPath: boolean
  /** Instances this node points at, for drawing links. */
  readonly edgesOut: readonly string[]
  /** Ticks left to provision, or null when not provisioning. */
  readonly provisioningTicksLeft: number | null
}

/** A `requires` port with what is currently wired into it. */
export interface PortFill {
  readonly port: PortDef
  /** instance_ids currently wired to this port. */
  readonly filled: readonly string[]
  /** `filled.length` is within [min, max]. */
  readonly satisfied: boolean
}

/* ---------------------------------------------------------------- actions --- */

/**
 * An action as offered on one specific tier. The engine has already evaluated
 * `constraint` against the node, so the component just renders.
 */
export interface ResolvedAction {
  readonly def: ActionDef
  /** Resolved from `def.minigame`. */
  readonly minigame: MinigameDef
  readonly availability: ActionAvailability
  /** Seconds left on `inst.action_cooldowns[def.id]`, 0 when ready. */
  readonly cooldownRemainingS: number
  /** Player-facing reason, shown when availability !== 'ready'. */
  readonly blockedReason?: string
  /** `money_cost` after `emergency_premium_multiplier`, when it applies. */
  readonly effectiveMoneyCost: number
  /** True when this action resolves an incident currently on the node. */
  readonly resolvesActiveIncident: boolean
  /** True when it arrived via the tier's `actions_extra`. */
  readonly fromActionsExtra: boolean
}

/* ---------------------------------------------------------------- signals --- */

/**
 * One signal line. `unlocked` is the whole observability mechanic: a locked
 * signal still occupies its row so the player can see what they are missing
 * and what would buy it.
 */
export interface ResolvedSignal {
  readonly level: SignalLevel
  readonly text: string
  readonly unlocked: boolean
  readonly requires: Constraint | null
  /** Human phrasing of `requires`, e.g. "tracing at tier 2 or higher". */
  readonly requirementLabel?: string
}

/* -------------------------------------------------------------- incidents --- */

export interface ActiveIncident {
  readonly def: IncidentDef
  /** Stable key - the same def can fire more than once over a run. */
  readonly key: string
  /** Empty for architecture scope. */
  readonly affectedInstanceIds: readonly string[]
  readonly elapsedTicks: number
  /** Counts down `duration_ticks`; null when the incident has no duration. */
  readonly ticksRemaining: number | null
  /** Counts down `escalate_after_ticks`; null when it cannot escalate. */
  readonly ticksToEscalation: number | null
  /** All four levels, each flagged locked or unlocked. */
  readonly signals: readonly ResolvedSignal[]
  /** Resolved from `def.resolved_by`; empty means survive-only. */
  readonly resolvingActions: readonly ActionDef[]
}

/* ---------------------------------------------------------------- metrics --- */

export interface MetricReading {
  readonly def: MetricDef
  readonly value: number
  /** Previous tick, for the delta arrow. */
  readonly previous?: number
  /** Oldest-to-newest, for the sparkline. */
  readonly series?: readonly number[]
  /** Derived from `value` against `def.healthy_range` and `def.direction`. */
  readonly status: Status
}

export interface LedgerLine {
  readonly kind: LedgerEventKind
  /** Already-priced amount. Negative is a charge. */
  readonly amount: number
  readonly tick: number
  readonly label: string
  /** The incident or action that emitted it. */
  readonly sourceId?: string
}

/* ------------------------------------------------------------ tier ladder --- */

/** One rung of the upgrade path, with the cost delta from the current tier. */
export interface TierLadderEntry {
  readonly tier: TierDef
  readonly isCurrent: boolean
  /** `cost_month` minus the current tier's. 0 on the current rung. */
  readonly costDelta: number
  /** Not yet reachable, or denied via `actions_deny`. */
  readonly locked: boolean
}

/* -------------------------------------------------------------- minigames --- */

/** What the player has entered so far, shaped per format. */
export type MinigameAnswer =
  | { readonly kind: 'ordered_sequence'; readonly order: readonly number[] }
  | { readonly kind: 'fill_blank'; readonly blanks: Readonly<Record<string, string>> }
  | { readonly kind: 'dial'; readonly value: number }
  | { readonly kind: 'wiring'; readonly zone: string | null; readonly connectTo: readonly string[] }
  | { readonly kind: 'evidence'; readonly choice: string | null }
  | { readonly kind: 'terminal'; readonly text: string }
  | { readonly kind: 'log_hunt'; readonly line: number | null }
  | { readonly kind: 'patch'; readonly content: string }
  | { readonly kind: 'monitor'; readonly metric: string | null; readonly t: number }
  | { readonly kind: 'classify'; readonly placements: Readonly<Record<string, string>> }

/**
 * One attempt at a minigame. `attempt` is 1-based; at `attempt > 3` the shell
 * shows `solution` and `reveal` in full - the player still executes and still
 * pays the time cost.
 */
export interface MinigameSession {
  readonly instance: MinigameInstanceDef
  readonly minigame: MinigameDef
  readonly format: FormatDef
  /** The action that invoked it, for cost and difficulty display. */
  readonly action: ActionDef
  readonly attempt: number
  /** Matched from `wrong_outcomes` on the last failed attempt. */
  readonly lastWrong?: WrongOutcome
  /** True once three attempts have failed. */
  readonly revealed: boolean
  readonly answer: MinigameAnswer
  /** True when the text was rewritten by AI for the live system (answer unchanged). */
  readonly aiText?: boolean
}

/* ------------------------------------------------------ design and debrief --- */

/** Untimed-phase readout. Every number is derived from the tier ladder. */
export interface DesignSummary {
  readonly budget: number
  readonly spent: number
  readonly projected: readonly MetricReading[]
  /** Weakness tags on the board that some incident hunts. */
  readonly exposedWeaknesses: readonly TagDef[]
  /** `requires` ports not satisfied - the board will not run. */
  readonly unsatisfiedPorts: readonly { readonly node: BoardNode; readonly port: PortFill }[]
}

export interface DebriefSummary {
  readonly scenarioName: string
  readonly cleared: boolean
  readonly ticks: number
  readonly finalMetrics: readonly MetricReading[]
  readonly incidentsFaced: readonly { readonly def: IncidentDef; readonly resolved: boolean }[]
  /** `teaches` from every instance played, deduped - the takeaway list. */
  readonly lessons: readonly { readonly instanceId: string; readonly teaches: string }[]
  readonly ledger: readonly LedgerLine[]
}

export interface ScenarioSummary {
  readonly id: string
  readonly name: string
  readonly blurb: string
  readonly locked: boolean
  /** 0–3. */
  readonly stars: number
  readonly startingBudget: number
  /** Layers this scenario lets the player build in. */
  readonly allowedLayers: readonly LayerId[]
}

/* ---------------------------------------------------- catalog lookup maps --- */

/**
 * Pre-built indexes. Components that need to resolve an id (a tag in
 * `tags_add`, an action in `resolved_by`) take this rather than scanning arrays.
 */
export interface CatalogIndex {
  readonly nodeById: ReadonlyMap<string, NodeDef>
  readonly tagById: ReadonlyMap<string, TagDef>
  readonly actionById: ReadonlyMap<string, ActionDef>
  readonly layerById: ReadonlyMap<LayerId, LayerDef>
  readonly metricById: ReadonlyMap<string, MetricDef>
  readonly incidentById: ReadonlyMap<string, IncidentDef>
  readonly minigameById: ReadonlyMap<string, MinigameDef>
  readonly formatById: ReadonlyMap<string, FormatDef>
}

/* ------------------------------------------------------------ depth mode ---- */

export type DepthMode = 'depth' | 'flat' | 'auto'
