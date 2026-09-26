/* ============================================================================
   Definition types - a 1:1 mirror of the schemas in data/schema/.
   ----------------------------------------------------------------------------
   These describe GLOBAL DEFINITIONS. Per CLAUDE.md §2 they are loaded once and
   never mutated: every field here is `readonly`, and nothing runtime-varying
   (health, current tier, runtime tags, utilisation) appears in this file. That
   lives in ./runtime.ts.

   Field names and enum members are taken verbatim from the schemas, so a
   component that destructures a definition is guaranteed to be reading a field
   that actually exists in data/.
   ========================================================================== */

/* ---------------------------------------------------------------- layers --- */

export type LayerId =
  | 'edge' | 'ingress' | 'compute' | 'data'
  | 'reliability' | 'observability' | 'delivery'

export interface LayerDef {
  readonly id: LayerId
  readonly name: string
  /** 1–4 for the request path; null for the three off-path layers. */
  readonly layer_index: number | null
  readonly on_request_path: boolean
  readonly description: string
}

/* ------------------------------------------------------------------ tags --- */

export type TagKind = 'weakness' | 'capability' | 'property' | 'posture'

export interface TagDef {
  readonly id: string
  /** Display text. Note: `label`, NOT `name` - tags are the one type that differs. */
  readonly label: string
  readonly kind: TagKind
  readonly description: string
  /** Incident ids that exploit this tag. May be empty. */
  readonly targeted_by: readonly string[]
  /** Action ids that remove it. Weakness tags always have at least one. */
  readonly resolved_by: readonly string[]
  /** `cold_cache` and `unbounded_queue` only. Never present in a tier definition. */
  readonly runtime_only?: boolean
}

/* ----------------------------------------------------------------- nodes --- */

export type CapacityUnit =
  | 'qps' | 'rps' | 'connections' | 'msgs_sec' | 'events_sec'
  | 'lookups_sec' | 'builds_day' | 'gb' | 'none'

export type EvictionPolicy =
  | 'noeviction' | 'allkeys_lru' | 'allkeys_lfu' | 'volatile_ttl'

/** The seven stats every tier must declare. */
export interface UniversalStats {
  readonly capacity: number
  readonly capacity_unit: CapacityUnit
  readonly base_latency_ms: number
  readonly availability_pct: number
  readonly cost_month: number
  readonly provision_time_s: number
  /** 0.0–1.0 - fraction of overall uptime lost if this node goes down. */
  readonly blast_radius: number
}

/**
 * The 36 optional per-role stats. The closed list lives in node.schema.json
 * under `…tiers.items.properties.stats.properties`; inventing a key fails
 * schema validation, so this type is deliberately exhaustive rather than
 * an index signature.
 */
export interface DomainStats {
  readonly max_connections?: number
  readonly iops?: number
  readonly storage_gb?: number
  readonly cpu_cores?: number
  readonly ram_gb?: number
  readonly durability_nines?: number
  readonly replication_lag_ms?: number | null
  readonly failover_time_s?: number | null
  readonly hit_ratio_pct?: number
  readonly ttl_s?: number
  readonly eviction_policy?: EvictionPolicy
  readonly cache_size_gb?: number
  readonly concurrency?: number
  readonly cold_start_ms?: number
  readonly replicas?: number
  readonly autoscale_max?: number
  readonly queue_depth_max?: number
  readonly retention_days?: number
  readonly propagation_s?: number
  readonly rule_count?: number
  readonly cert_expiry_days?: number
  readonly edge_locations?: number
  readonly bandwidth_gbps?: number
  readonly sample_rate_pct?: number
  readonly cardinality_max?: number
  readonly index_size_gb?: number
  readonly rebuild_time_s?: number
  readonly rpo_minutes?: number
  readonly rto_minutes?: number
  readonly backup_frequency_h?: number
  readonly pipeline_minutes?: number
  readonly rollback_time_s?: number
  readonly flag_count?: number
  readonly rotation_days?: number
  readonly oncall_engineers?: number
  readonly fatigue_rate?: number
}

export type TierStats = UniversalStats & DomainStats

/** Usage-based rates. Closed list of 7 keys in the schema. */
export interface CostVariable {
  readonly per_gb_transfer?: number
  readonly per_million_requests?: number
  readonly per_gb_storage_month?: number
  readonly per_million_queries?: number
  readonly per_million_ops?: number
  readonly per_gb_ingested?: number
  readonly per_build_minute?: number
}

export interface TierDef {
  /** Contiguous from 1. Capped at 4 by state.schema.json. */
  readonly tier: number
  readonly name: string
  readonly stats: TierStats
  readonly cost_variable?: CostVariable
  /** Definition tags only - never a runtime-only tag (CLAUDE.md §7). */
  readonly tags: readonly string[]
  readonly actions_extra?: readonly string[]
  /** Every node's top tier carries `['upgrade_tier']`. */
  readonly actions_deny?: readonly string[]
}

/** A `requires` port: what this node needs wired into it. */
export interface PortDef {
  readonly port: string
  /** Capability ids this port will accept. */
  readonly accepts: readonly string[]
  readonly min: number
  readonly max: number
}

export interface NodeDef {
  readonly id: string
  readonly name: string
  readonly layer: LayerId
  readonly role: string
  readonly description: string
  readonly singleton: boolean
  readonly max_instances: number
  readonly provides: readonly string[]
  readonly requires: readonly PortDef[]
  readonly overridable_edges: boolean
  readonly tiers: readonly TierDef[]
}

/* --------------------------------------------------------------- actions --- */

/**
 * The ten constraint keys defined in src/validate/matchActions.ts. Shared by
 * action gating, incident `target`, `fires_when`, and `signals[].requires`.
 * An empty object `{}` matches every tier (used by `upgrade_tier`).
 */
export interface Constraint {
  readonly layers?: readonly LayerId[]
  readonly roles?: readonly string[]
  readonly node_ids?: readonly string[]
  /** minItems 1 in the schema - an empty array would be unsatisfiable. */
  readonly tags_all?: readonly string[]
  readonly tags_any?: readonly string[]
  readonly tags_none?: readonly string[]
  readonly min_tier?: number
  readonly max_tier?: number
  readonly min_health?: number
  readonly max_health?: number
}

/** Metric deltas are authored as signed strings, e.g. `"+1.0"`, `"-0.05"`. */
export type MetricDeltaMap = Readonly<Record<MetricId, string>>

export interface ActionOutcomeSuccess {
  readonly tags_add?: readonly string[]
  readonly tags_remove?: readonly string[]
  /** Keys must be declared in `stats` on every tier the action can match. */
  readonly stats_delta?: Readonly<Record<string, string | number>>
  readonly health_delta?: number
  readonly tier_delta?: number
  readonly cost_delta?: number
  readonly metrics?: Partial<MetricDeltaMap>
}

export interface ActionOutcomeFail {
  readonly health_delta?: number
  readonly tags_add?: readonly string[]
  readonly metrics?: Partial<MetricDeltaMap>
}

export interface ActionDef {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Minigame id from data/minigames/registry.json. Required. */
  readonly minigame: string
  /** 1–5. With `minigame`, forms the difficulty-slot. Required. */
  readonly difficulty: number
  /**
   * Optional extra minigame/difficulty slots. Slot 0 is always the action's
   * own `minigame`/`difficulty`; pool entries are slots 1+. The picker in
   * src/engine/minigamePick.ts selects one slot deterministically from
   * (rng_seed, action id, context key). Every pool entry is a difficulty-slot:
   * checkSlotCoverage and checkRegistryMatchesActions iterate slotsFor(action).
   */
  readonly minigame_pool?: readonly { readonly minigame: string; readonly difficulty: number }[]
  readonly time_cost_s: number
  readonly money_cost: number
  readonly cooldown_s: number
  readonly constraint: Constraint
  readonly on_success: ActionOutcomeSuccess
  readonly on_fail: ActionOutcomeFail
}

/* --------------------------------------------------------------- metrics --- */

export type MetricId =
  | 'uptime_pct' | 'p95_latency_ms' | 'error_rate_pct' | 'reputation'
  | 'users' | 'cost_month' | 'profit_month'

export type MetricUnit = 'percent' | 'ms' | 'count' | 'currency_month' | 'score'
export type MetricKind = 'technical' | 'business'
export type MetricDerivedFrom = 'graph' | 'history' | 'instances' | 'technical' | 'business'
export type MetricDirection = 'higher_is_better' | 'lower_is_better'

export interface MetricDef {
  readonly id: MetricId
  readonly name: string
  readonly kind: MetricKind
  readonly derived_from: MetricDerivedFrom
  /** Authored data, evaluated by the engine. Shown verbatim in the UI on request. */
  readonly formula: string
  readonly unit: MetricUnit
  readonly healthy_range: readonly [number, number]
  readonly clamp: readonly [number, number]
  readonly direction: MetricDirection
}

export type LedgerEventKind =
  | 'provision' | 'action' | 'sla_credit' | 'overage'
  | 'emergency_premium' | 'data_egress' | 'incident_remediation'

/** The single source of pricing constants (CLAUDE.md §9). */
export interface Economy {
  readonly arpu: number
  readonly starting_budget: number
  readonly credit_rate: number
  readonly emergency_premium_multiplier: number
  readonly reputation_decay_per_tick: number
  readonly reputation_recovery_per_tick: number
  readonly tick_seconds: number
  readonly reputation_growth_rate: number
  readonly latency_churn_rate: number
  readonly outage_churn_rate: number
  readonly saturation_knee: number
  readonly saturation_exponent: number
  readonly ledger_event_kinds: readonly LedgerEventKind[]
}

/* ------------------------------------------------------------- incidents --- */

export type IncidentFamily =
  | 'infrastructure' | 'capacity' | 'data' | 'queue'
  | 'security' | 'delivery' | 'business'

export type IncidentScope = 'instance' | 'group' | 'architecture'
export type IncidentGroupBy = 'region' | 'layer' | 'def_id'
export type LedgerEventWhen = 'on_trigger' | 'per_tick' | 'on_resolve' | 'on_expire'
/** 0 = non-diagnostic only · 1 = layer/region · 2 = instance · 3 = root cause. */
export type SignalLevel = 0 | 1 | 2 | 3

export interface IncidentGates {
  readonly min_tick?: number
  readonly min_users?: number
  readonly cooldown_ticks?: number
}

export interface IncidentDamage {
  readonly down?: boolean
  readonly health_delta?: number
  readonly utilization_delta_pct?: number
  /** Where runtime-only tags come from - `cold_cache`, `unbounded_queue`. */
  readonly tags_add?: readonly string[]
}

export interface IncidentLedgerEvent {
  readonly kind: LedgerEventKind
  readonly when: LedgerEventWhen
  /** An expression, never a currency amount (CLAUDE.md §13). */
  readonly basis: string
}

export interface SignalDef {
  readonly level: SignalLevel
  /** What the player's observability setup must satisfy. null = always visible. */
  readonly requires: Constraint | null
  readonly text: string
}

/** Architecture scope only: a posture gap rather than a component failure. */
export interface FiresWhen {
  readonly any_node?: Constraint
  readonly no_node?: Constraint
}

export interface IncidentDef {
  readonly id: string
  readonly name: string
  readonly family: IncidentFamily
  /** 1–5. Summed across active incidents to form `incident_severity`. */
  readonly severity: number
  readonly scope: IncidentScope
  readonly group_by: IncidentGroupBy | null
  /** null for architecture scope. */
  readonly target: Constraint | null
  /** Non-null for architecture scope only. */
  readonly fires_when: FiresWhen | null
  readonly gates: IncidentGates
  readonly base_weight: number
  readonly weight_per_target: number
  readonly damage: IncidentDamage
  /** Empty means survive-only, which requires a `duration_ticks`. */
  readonly resolved_by: readonly string[]
  readonly duration_ticks: number | null
  readonly escalates_to: string | null
  readonly escalate_after_ticks: number | null
  readonly ledger_events: readonly IncidentLedgerEvent[]
  readonly signals: readonly SignalDef[]
}

/* ------------------------------------------------------------- minigames --- */

export type FormatId = 'ordered_sequence' | 'fill_blank' | 'dial' | 'wiring' | 'evidence' | 'terminal' | 'log_hunt' | 'patch' | 'monitor' | 'classify'
export type LeverType = 'integer' | 'number' | 'boolean' | 'enum'

export interface LeverDef {
  readonly type: LeverType
  readonly description: string
  readonly min?: number
  readonly max?: number
  readonly values?: readonly (string | number)[]
}

export interface FormatDef {
  readonly id: FormatId
  readonly name: string
  readonly description: string
  readonly levers: Readonly<Record<string, LeverDef>>
}

export interface MinigameDef {
  readonly id: string
  readonly name: string
  readonly format: FormatId
  readonly description: string
}

/**
 * `when` legality is per-format and lives in WHEN_BY_FORMAT in
 * tests/helpers/dataFiles.ts, not in formats.json. The schema enum is the flat
 * union of all seven values, which is what this type mirrors.
 */
export type WrongWhen =
  | 'any' | 'below' | 'above' | 'wrong_order'
  | 'wrong_value' | 'wrong_target' | 'wrong_choice' | 'wrong_command' | 'wrong_line'
  | 'too_early' | 'too_late' | 'wrong_metric' | 'wrong_bin'

export interface WrongOutcome {
  readonly when: WrongWhen
  /** Concrete numbers moving the wrong way. Shown on each failed attempt. */
  readonly shows: string
  readonly why_wrong: string
}

export interface Distractor {
  readonly choice: string
  readonly why_wrong: string
}

/* --- format-specific `given` / `solution` payloads -------------------------
   Schema-wise these are `object, minProperties: 1` and nothing inside is
   checked; the required keys are asserted by checkInstanceShapes in
   src/validate/minigameChecks.ts. These interfaces encode that same table so
   the format components get real types.
   ------------------------------------------------------------------------- */

export interface SequenceGiven { readonly steps: readonly string[] }
export interface SequenceSolution { readonly order: readonly number[] }

export interface FillBlankGiven {
  readonly template: string
  readonly language?: string
  readonly options?: Readonly<Record<string, readonly string[]>>
  readonly facts?: string
}
export interface FillBlankSolution { readonly blanks: Readonly<Record<string, string>> }

export interface DialRow { readonly label: string; readonly value: string }
export interface DialGiven {
  readonly table: readonly DialRow[]
  readonly unit: string
  readonly range: { readonly min: number; readonly max: number }
}
export interface DialSolution { readonly value: number }

export interface WiringNode {
  readonly id: string
  readonly label: string
  readonly zone?: string
}
export interface WiringEdge { readonly from: string; readonly to: string }
export interface WiringGiven {
  readonly nodes: readonly WiringNode[]
  readonly zones: readonly string[]
  readonly place: { readonly id: string; readonly label: string }
  readonly edges?: readonly WiringEdge[]
}
export interface WiringSolution {
  readonly zone: string
  readonly connect_to: readonly string[]
}

export type EvidenceKind = 'log' | 'explain' | 'deploy_history'
export interface EvidenceGiven {
  readonly kind: EvidenceKind
  readonly output: string
  readonly context?: string
}
export interface EvidenceSolution { readonly choice: string }

export interface TerminalGiven {
  readonly prefix: string
  readonly history: readonly string[]
  readonly placeholder?: string
}
export interface TerminalSolution { readonly accepts: readonly string[] }

export interface LogHuntLine {
  readonly ts: string
  readonly level: string
  readonly text: string
}
export interface LogHuntGiven {
  readonly source: string
  readonly lines: readonly LogHuntLine[]
}
export interface LogHuntSolution {
  /** 1-based line number. */
  readonly line: number
  /** Other 1-based lines that are the same root cause; also graded correct. */
  readonly accept?: readonly number[]
}

export interface PatchGiven {
  readonly filename: string
  readonly language: string
  readonly content: string
}
export interface PatchSolution {
  /** 1-based line number. Only this line may change. */
  readonly line: number
  /** Normalised target line must contain each of these strings. */
  readonly must_contain: readonly string[]
  /** Normalised target line must NOT contain any of these strings. */
  readonly must_not_contain?: readonly string[]
}

export interface MonitorMetric {
  readonly id: string
  readonly label: string
  readonly unit: string
  readonly start: number
  readonly slope: number
  readonly amplitude: number
  readonly period_s: number
  /** Optional physical bounds applied by valueAt. */
  readonly floor?: number
  readonly ceil?: number
}
export interface MonitorGiven {
  readonly metrics: readonly MonitorMetric[]
  /** Total duration of the monitor session in seconds. */
  readonly duration_s: number
  /** The policy rule shown on screen; names a threshold but not when to click. */
  readonly rule: string
}
export interface MonitorSolution {
  readonly metric: string
  readonly threshold: number
  readonly direction: 'above' | 'below'
  readonly window_s: number
}

export interface ClassifyItem { readonly id: string; readonly label: string }
export interface ClassifyBin { readonly id: string; readonly label: string }
export interface ClassifyGiven {
  readonly items: readonly ClassifyItem[]
  readonly bins: readonly ClassifyBin[]
}
/** Maps each item id to the bin id it should go in. */
export interface ClassifySolution { readonly bins: Readonly<Record<string, string>> }

export type InstanceGiven =
  | SequenceGiven | FillBlankGiven | DialGiven | WiringGiven | EvidenceGiven | TerminalGiven | LogHuntGiven | PatchGiven | MonitorGiven | ClassifyGiven
export type InstanceSolution =
  | SequenceSolution | FillBlankSolution | DialSolution | WiringSolution | EvidenceSolution | TerminalSolution | LogHuntSolution | PatchSolution | MonitorSolution | ClassifySolution

export interface MinigameInstanceDef {
  readonly id: string
  readonly minigame: string
  /** Must be a difficulty some action actually invokes this minigame at. */
  readonly difficulty: number
  /** Optional: only these actions may open this instance (see checkForActionsRefs). */
  readonly for_actions?: readonly string[]
  readonly brief: string
  /** A transferable principle, never a restatement of the answer. */
  readonly teaches: string
  readonly levers: Readonly<Record<string, string | number | boolean>>
  readonly given: InstanceGiven
  readonly solution: InstanceSolution
  readonly distractors?: readonly Distractor[]
  readonly wrong_outcomes: readonly WrongOutcome[]
  /** Explains the mechanism. Revealed in full after the third failure. */
  readonly reveal: string
  readonly _comment_given?: string
}

/* ------------------------------------------------- the whole catalog ------- */

/** Everything under data/, loaded once. Handed to the UI as one frozen object. */
export interface Catalog {
  readonly layers: readonly LayerDef[]
  readonly tags: readonly TagDef[]
  readonly nodes: readonly NodeDef[]
  readonly actions: readonly ActionDef[]
  readonly metrics: readonly MetricDef[]
  readonly economy: Economy
  readonly incidents: readonly IncidentDef[]
  readonly formats: readonly FormatDef[]
  readonly minigames: readonly MinigameDef[]
  readonly instances: readonly MinigameInstanceDef[]
}
