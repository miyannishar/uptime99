/* Public API. The UI imports from here and adapts; see
   docs/handoffs/2026-09-19-engine-to-ui-contract.md. Nothing in src/engine
   may import from src/ui. */

export const PHASE_IDS = ['design', 'run', 'debrief'] as const
export type PhaseId = (typeof PHASE_IDS)[number]

/** Dependency order: each metric may only read those before it. */
export const METRIC_IDS = [
  'uptime_pct', 'p95_latency_ms', 'error_rate_pct',
  'reputation', 'users', 'cost_month', 'profit_month',
] as const
export type MetricId = (typeof METRIC_IDS)[number]

export type Status = 'ok' | 'warn' | 'bad' | 'unknown'

export type ActionAvailability =
  | 'ready' | 'cooldown' | 'unaffordable' | 'provisioning' | 'constraint'

/* ------------------------------------------------------------ save state --- */

export interface NodeInstance {
  readonly instance_id: string
  readonly def_id: string
  readonly tier: number
  readonly region: string
  readonly health: number
  readonly utilization_pct: number
  readonly down: boolean
  readonly tags_runtime: readonly string[]
  readonly action_cooldowns: Readonly<Record<string, number>>
  readonly edges_out: readonly string[]
  readonly provisioning_until_tick: number | null
  readonly created_tick: number
}

export interface IncidentRecord {
  /** Stable across a run; the same definition may fire more than once. */
  readonly key: string
  readonly incident_id: string
  /** null for architecture scope, which targets no node (and null after escalation
   *  into architecture scope, even when the source incident had a real instance_id).
   *  A group incident produces one record per affected instance — all sharing the
   *  same `key` — so a group event is a set of records with non-null instance_ids. */
  readonly instance_id: string | null
  readonly started_tick: number
  readonly escalate_at_tick: number | null
  readonly expires_at_tick: number | null
  /** minigame instance id -> failed attempts. Drives the 3-failure reveal. */
  readonly attempts: Readonly<Record<string, number>>
}

export interface LedgerEntry {
  readonly kind: string
  readonly basis: number
  readonly cadence: 'once' | 'monthly'
  /** Already priced. Negative is a charge. */
  readonly amount: number
  readonly tick: number
  readonly instance_id: string | null
}

export interface SessionState {
  readonly peak_p95_ms: number
  readonly incidents_fired: number
  readonly incidents_resolved: number
  readonly status: 'running' | 'complete'
}

export interface GameState {
  readonly save_version: 1
  readonly scenario_id: string
  readonly phase: PhaseId
  readonly tick: number
  readonly budget: number
  /** The seeded stream position. Scrambled once by startRun (raw integer seeds are
   *  pathological for xorshift32), then advanced by each tick. Null in the design
   *  phase; set to a non-null integer by startRun before the first advance call. */
  readonly rng_seed: number | null
  /** Only the recursive metrics persist; the rest derive each tick. */
  readonly carried: { readonly reputation: number; readonly users: number }
  /** Bounded to HISTORY_WINDOW ticks, oldest first. */
  readonly history: Readonly<Partial<Record<MetricId, readonly number[]>>>
  readonly instances: readonly NodeInstance[]
  readonly incidents: readonly IncidentRecord[]
  readonly ledger: readonly LedgerEntry[]
  readonly session: SessionState
  /** incident id → the tick it last fired. Drives gates.cooldown_ticks, which
      cannot be derived from `incidents` because a resolved incident leaves no
      trace there. */
  readonly last_fired: Readonly<Record<string, number>>
}

export const HISTORY_WINDOW = 60

/* ------------------------------------------------------------ projections --- */

export interface MetricReadingView {
  readonly id: MetricId
  readonly value: number
  readonly previous?: number
  readonly series?: readonly number[]
  readonly status: Status
}

export interface PortFillView {
  readonly port: string
  readonly accepts: readonly string[]
  readonly min: number
  readonly max: number
  readonly filled: readonly string[]
  readonly satisfied: boolean
}

export interface BoardNodeView {
  readonly instance_id: string
  readonly def_id: string
  readonly name: string
  readonly layer: string
  readonly tier: number
  readonly region: string
  readonly health: number
  readonly utilization_pct: number
  readonly down: boolean
  /** Combined status folding health, down, and utilisation together.
   * Use `healthStatus` and `utilStatus` when rendering two independent
   * bars — a node at health 95 but utilisation 140% needs them to differ. */
  readonly status: Status
  /** Health dimension only: bad ≤ 0 or down; warn < 60; ok otherwise. */
  readonly healthStatus: Status
  /** Utilisation dimension only: bad ≥ 150%; warn ≥ saturation_knee (80%); ok otherwise. */
  readonly utilStatus: Status
  /** Definition tags for the current tier merged with tags_runtime. */
  readonly tags: readonly string[]
  /** Contributes to the p95 sum: on-path layer AND not async/scheduled. */
  readonly onRequestPath: boolean
  readonly edgesOut: readonly string[]
  readonly provisioningTicksLeft: number | null
  readonly x: number
  readonly y: number
}

/* ------------------------------------------------------------- scenarios --- */

export type EndCondition =
  | { readonly kind: 'fixed_window'; readonly ticks: number }
  | { readonly kind: 'endless' }
  | { readonly kind: 'objectives' }

export interface ScenarioBoardEntry {
  readonly def_id: string
  readonly tier: number
  readonly region: string
  readonly x: number
  readonly y: number
}

export interface ScenarioDef {
  readonly id: string
  readonly name: string
  readonly blurb: string
  /** Maximum stars a player can earn on this scenario, authored in the definition.
   * Deliberately NOT named `stars` to prevent a straight-through assignment in adapt.ts —
   * earned stars are save-state (UI-local), not authored data. */
  readonly star_target: number
  readonly level: number | null
  readonly unlocked_by: readonly string[]
  readonly incident_source: 'scripted' | 'weighted'
  readonly starting_budget: number
  readonly allowed_layers: readonly string[]
  readonly board: readonly ScenarioBoardEntry[]
  readonly end: EndCondition
  readonly incidents: readonly { readonly incident_id: string; readonly at_tick: number }[]
}
