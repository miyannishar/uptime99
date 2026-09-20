/* ============================================================================
   Formatting and derivation helpers.
   ----------------------------------------------------------------------------
   Every unit and enum referenced here comes from the schemas. The point of this
   file is that no component hardcodes a unit string: a component is handed a
   raw number plus the key or unit it belongs to, and asks here how to render it.
   ========================================================================== */

import type {
  CapacityUnit, MetricDef, MetricUnit, TagKind, LayerId, Constraint,
} from '../types'
import type { Status } from '../types'

/* --------------------------------------------------------------- numbers --- */

export function compactNumber(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return trim(n / 1e9) + 'B'
  if (abs >= 1e6) return trim(n / 1e6) + 'M'
  if (abs >= 1e4) return trim(n / 1e3) + 'k'
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, '')
}

export function formatMoney(n: number, opts: { sign?: boolean } = {}): string {
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}$${compactNumber(Math.abs(n))}`
}

/** Action `time_cost_s`, `provision_time_s`, cooldowns. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'instant'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** mm:ss, for incident elapsed time. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/* ------------------------------------------------- metrics (metrics.json) --- */

/** Renders a metric value according to its declared `unit`. */
export function formatMetric(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'percent':
      // Uptime needs its nines: 99.94 must not round to 99.9.
      return `${value.toFixed(value >= 99 ? 2 : value >= 10 ? 1 : 2)}%`
    case 'ms':
      return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`
    case 'count':
      return compactNumber(value)
    case 'currency_month':
      return `${formatMoney(value)}/mo`
    case 'score':
      return String(Math.round(value))
  }
}

/**
 * Buckets a metric against its own `healthy_range` and `direction`. Nothing is
 * special-cased per metric id - the thresholds are authored data.
 */
export function metricStatus(value: number, def: MetricDef): Status {
  const [lo, hi] = def.healthy_range
  if (value >= lo && value <= hi) return 'ok'
  if (def.direction === 'higher_is_better') {
    // How far below the healthy floor, relative to the floor's own scale.
    const shortfall = (lo - value) / (Math.abs(lo) || 1)
    return shortfall > 0.15 ? 'bad' : 'warn'
  }
  const overshoot = (value - hi) / (Math.abs(hi) || 1)
  return overshoot > 0.5 ? 'bad' : 'warn'
}

/** Signed delta against the previous tick, already oriented by direction. */
export function metricTrend(
  value: number,
  previous: number | undefined,
  def: MetricDef,
): { arrow: '↑' | '↓' | '·'; good: boolean; delta: number } {
  if (previous === undefined || value === previous) return { arrow: '·', good: true, delta: 0 }
  const rising = value > previous
  const good = rising === (def.direction === 'higher_is_better')
  return { arrow: rising ? '↑' : '↓', good, delta: value - previous }
}

/* ------------------------------------------------ node state derivations --- */

/** `down` outranks health: a down node is unreachable, not merely failing. */
export function healthStatus(health: number, down: boolean): Status {
  if (down) return 'bad'
  if (health >= 70) return 'ok'
  if (health >= 35) return 'warn'
  return 'bad'
}

/**
 * Utilisation buckets against the economy's `saturation_knee`, which is where
 * `saturation_curve` starts to bite. Past 100% the node is shedding requests.
 */
export function utilisationStatus(pct: number, saturationKnee: number): Status {
  if (pct >= 100) return 'bad'
  if (pct >= saturationKnee * 100) return 'warn'
  return 'ok'
}

/* -------------------------------------------- capacity (node.schema.json) --- */

const CAPACITY_UNIT_LABEL: Record<CapacityUnit, string> = {
  qps: 'qps',
  rps: 'rps',
  connections: 'conns',
  msgs_sec: 'msg/s',
  events_sec: 'evt/s',
  lookups_sec: 'lookup/s',
  builds_day: 'builds/day',
  gb: 'GB',
  none: '',
}

export function formatCapacity(value: number, unit: CapacityUnit): string {
  const label = CAPACITY_UNIT_LABEL[unit]
  return label ? `${compactNumber(value)} ${label}` : compactNumber(value)
}

/* ------------------------------------------------- tier stats (all 43) ----- */

interface StatMeta { readonly label: string; readonly unit?: string; readonly digits?: number }

/**
 * Display metadata for every key the `stats` object allows. The list is closed
 * by `additionalProperties: false`, so this map is exhaustive by construction -
 * if a new stat is added to the schema, TypeScript will not complain but the
 * inspector will fall back to a humanised key, which is the safe failure.
 */
export const STAT_META: Readonly<Record<string, StatMeta>> = {
  /* universal */
  capacity: { label: 'Capacity' },
  capacity_unit: { label: 'Capacity unit' },
  base_latency_ms: { label: 'Base latency', unit: 'ms' },
  availability_pct: { label: 'Availability', unit: '%', digits: 2 },
  cost_month: { label: 'Cost', unit: '/mo' },
  provision_time_s: { label: 'Provision time', unit: 's' },
  blast_radius: { label: 'Blast radius', digits: 2 },
  /* domain */
  max_connections: { label: 'Max connections' },
  iops: { label: 'IOPS' },
  storage_gb: { label: 'Storage', unit: 'GB' },
  cpu_cores: { label: 'vCPU', unit: 'cores' },
  ram_gb: { label: 'Memory', unit: 'GB' },
  durability_nines: { label: 'Durability', unit: 'nines' },
  replication_lag_ms: { label: 'Replication lag', unit: 'ms' },
  failover_time_s: { label: 'Failover time', unit: 's' },
  hit_ratio_pct: { label: 'Hit ratio', unit: '%', digits: 1 },
  ttl_s: { label: 'TTL', unit: 's' },
  eviction_policy: { label: 'Eviction policy' },
  cache_size_gb: { label: 'Cache size', unit: 'GB' },
  concurrency: { label: 'Concurrency' },
  cold_start_ms: { label: 'Cold start', unit: 'ms' },
  replicas: { label: 'Replicas' },
  autoscale_max: { label: 'Autoscale max' },
  queue_depth_max: { label: 'Max queue depth' },
  retention_days: { label: 'Retention', unit: 'days' },
  propagation_s: { label: 'Propagation', unit: 's' },
  rule_count: { label: 'Rules' },
  cert_expiry_days: { label: 'Cert expiry', unit: 'days' },
  edge_locations: { label: 'Edge locations' },
  bandwidth_gbps: { label: 'Bandwidth', unit: 'Gbps' },
  sample_rate_pct: { label: 'Sample rate', unit: '%', digits: 1 },
  cardinality_max: { label: 'Max cardinality' },
  index_size_gb: { label: 'Index size', unit: 'GB' },
  rebuild_time_s: { label: 'Rebuild time', unit: 's' },
  rpo_minutes: { label: 'RPO', unit: 'min' },
  rto_minutes: { label: 'RTO', unit: 'min' },
  backup_frequency_h: { label: 'Backup every', unit: 'h' },
  pipeline_minutes: { label: 'Pipeline', unit: 'min' },
  rollback_time_s: { label: 'Rollback time', unit: 's' },
  flag_count: { label: 'Flags' },
  rotation_days: { label: 'Rotation', unit: 'days' },
  oncall_engineers: { label: 'On-call engineers' },
  fatigue_rate: { label: 'Fatigue rate', digits: 2 },
}

export function statLabel(key: string): string {
  return STAT_META[key]?.label ?? humanise(key)
}

/** Renders one `stats` entry. `capacity` needs the tier's `capacity_unit`. */
export function formatStat(
  key: string,
  value: number | string | null,
  capacityUnit?: CapacityUnit,
): string {
  if (value === null) return '-'
  if (typeof value === 'string') return humanise(value)
  if (key === 'capacity') return formatCapacity(value, capacityUnit ?? 'none')
  if (key === 'cost_month') return `${formatMoney(value)}/mo`
  const meta = STAT_META[key]
  const num = meta?.digits !== undefined
    ? value.toFixed(meta.digits)
    : compactNumber(value)
  if (!meta?.unit) return num
  return meta.unit.startsWith('/') ? `${num}${meta.unit}` : `${num} ${meta.unit}`
}

/* -------------------------------------- cost_variable (7 closed keys) ------ */

export const COST_VARIABLE_META: Readonly<Record<string, StatMeta>> = {
  per_gb_transfer: { label: 'Egress', unit: '/GB' },
  per_million_requests: { label: 'Requests', unit: '/M req' },
  per_gb_storage_month: { label: 'Storage', unit: '/GB-mo' },
  per_million_queries: { label: 'Queries', unit: '/M queries' },
  per_million_ops: { label: 'Operations', unit: '/M ops' },
  per_gb_ingested: { label: 'Ingest', unit: '/GB' },
  per_build_minute: { label: 'Build time', unit: '/build-min' },
}

export function formatCostVariable(key: string, rate: number): string {
  const meta = COST_VARIABLE_META[key]
  const money = rate < 0.01 ? `$${rate.toFixed(4)}` : formatMoney(rate)
  return `${money}${meta?.unit ?? ''}`
}

/* ------------------------------------------------------ enum presentation --- */

export function humanise(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** CSS custom property carrying a tag kind's colour. */
export function tagKindVar(kind: TagKind): string {
  return `var(--tag-${kind})`
}

export function tagKindLineVar(kind: TagKind): string {
  return `var(--tag-${kind}-line)`
}

/** CSS custom property carrying a layer's accent colour. */
export function layerVar(id: LayerId): string {
  return `var(--layer-${id})`
}

export function severityVar(severity: number): string {
  return `var(--sev-${Math.min(5, Math.max(1, Math.round(severity)))})`
}

/* ---------------------------------------- constraints -> readable English --- */

/**
 * Turns a `Constraint` into a sentence. Used for `signals[].requires` (what
 * observability would unlock this line) and for an action's blocked reason.
 * The ten keys are the full vocabulary from src/validate/matchActions.ts.
 */
export function describeConstraint(
  c: Constraint | null,
  nameOf: (id: string) => string = (id) => id,
): string {
  if (!c) return 'always visible'
  const parts: string[] = []
  if (c.node_ids?.length) parts.push(orList(c.node_ids.map(nameOf)))
  if (c.layers?.length) parts.push(`${orList(c.layers.map(humanise))} layer`)
  if (c.roles?.length) parts.push(orList(c.roles.map(humanise)))
  if (c.min_tier !== undefined && c.max_tier !== undefined) {
    parts.push(`tier ${c.min_tier}–${c.max_tier}`)
  } else if (c.min_tier !== undefined) {
    parts.push(`tier ${c.min_tier} or higher`)
  } else if (c.max_tier !== undefined) {
    parts.push(`tier ${c.max_tier} or lower`)
  }
  if (c.tags_all?.length) parts.push(`carrying ${andList(c.tags_all.map(nameOf))}`)
  if (c.tags_any?.length) parts.push(`carrying ${orList(c.tags_any.map(nameOf))}`)
  if (c.tags_none?.length) parts.push(`without ${orList(c.tags_none.map(nameOf))}`)
  if (c.min_health !== undefined) parts.push(`health ≥ ${c.min_health}`)
  if (c.max_health !== undefined) parts.push(`health ≤ ${c.max_health}`)
  return parts.length ? parts.join(', ') : 'any node'
}

function orList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`
}

function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
}

/* ------------------------------------------------------------- signals ----- */

export const SIGNAL_LEVEL_LABEL: Readonly<Record<number, string>> = {
  0: 'Something is wrong',
  1: 'Layer or region named',
  2: 'Instance named',
  3: 'Root cause named',
}

/* ------------------------------------------------------------- utilities --- */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** 0–1 position of `value` within `[lo, hi]`. */
export function ratio(value: number, lo: number, hi: number): number {
  if (hi === lo) return 0
  return clamp((value - lo) / (hi - lo), 0, 1)
}

/**
 * Class joiner. Takes `unknown` so `someReactNode && styles.x` is safe - a
 * ReactNode can legitimately be `0` or `0n`, which a boolean-only signature
 * rejects and `filter(Boolean)` would silently drop anyway.
 */
export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ')
}
