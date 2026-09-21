/* Template resolver — pure, browser-safe, no I/O.
   Replaces {{variable}} and {{variable ± N}} placeholders in authored strings
   with values from a TemplateContext. */

import type { GameState, TicketRecord } from './types'
import type { EngineCatalog } from './catalogFrom'

export interface TemplateContext {
  node_name?: string
  node_id?: string
  current_tier?: number
  target_tier?: number
  current_capacity?: string
  target_capacity?: string
  current_cost?: number
  target_cost?: number
  utilization_pct?: number
  health?: number
  layer_name?: string
  incident_name?: string
  incident_severity?: number
}

/**
 * Replace {{variable}} and {{variable ± N}} placeholders in text with values
 * from ctx. Unresolved placeholders are left as-is (never throw).
 */
export function resolveText(text: string, ctx: TemplateContext): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, raw: string) => {
    const expr = raw.trim()
    // Direct key lookup
    if (Object.prototype.hasOwnProperty.call(ctx, expr)) {
      const val = (ctx as Record<string, unknown>)[expr]
      return val === undefined || val === null ? '' : String(val)
    }
    // Arithmetic: {{variable + N}} or {{variable - N}}
    const arith = expr.match(/^(\w+)\s*([+-])\s*(\d+)$/)
    if (arith) {
      const base = (ctx as Record<string, unknown>)[arith[1]]
      if (typeof base === 'number') {
        const n = parseInt(arith[3], 10)
        return String(arith[2] === '+' ? base + n : base - n)
      }
    }
    // Unknown — leave as-is
    return `{{${raw}}}`
  })
}

/**
 * Deep-resolve all string values in obj without mutating it.
 * Uses JSON round-trip for correct handling of nested objects and arrays.
 */
export function resolveObject<T>(obj: T, ctx: TemplateContext): T {
  return JSON.parse(resolveText(JSON.stringify(obj), ctx))
}

/** Build context from a live node instance. */
export function buildNodeContext(
  state: GameState,
  instanceId: string,
  catalog: EngineCatalog,
): TemplateContext {
  const inst = state.instances.find((i) => i.instance_id === instanceId)
  if (!inst) return {}
  const def = catalog.nodeById.get(inst.def_id) as any
  if (!def) return {}
  const tierDef = def.tiers?.find((t: any) => t.tier === inst.tier)
  const nextTierDef = def.tiers?.find((t: any) => t.tier === inst.tier + 1)
  const layer = catalog.layerById.get(def.layer) as any
  const fmtCap = (t: any): string =>
    t ? `${t.stats.capacity} ${t.stats.capacity_unit}` : '—'
  return {
    node_name: def.name,
    node_id: def.id,
    current_tier: inst.tier,
    target_tier: inst.tier + 1,
    current_capacity: fmtCap(tierDef),
    target_capacity: fmtCap(nextTierDef),
    current_cost: tierDef?.stats?.cost_month ?? 0,
    target_cost: nextTierDef?.stats?.cost_month ?? 0,
    utilization_pct: Math.round(inst.utilization_pct),
    health: inst.health,
    layer_name: layer?.name ?? def.layer,
  }
}

/** Build context from an active incident record group (keyed by incidentKey). */
export function buildIncidentContext(
  state: GameState,
  incidentKey: string,
  catalog: EngineCatalog,
): TemplateContext {
  const recs = state.incidents.filter((r) => r.key === incidentKey)
  if (!recs.length) return {}
  const rep = recs[0]
  const incDef = catalog.incidentById.get(rep.incident_id) as any
  const inst = rep.instance_id
    ? state.instances.find((i) => i.instance_id === rep.instance_id)
    : undefined
  const nodeDef = inst ? (catalog.nodeById.get(inst.def_id) as any) : undefined
  const layer = nodeDef ? (catalog.layerById.get(nodeDef.layer) as any) : undefined
  return {
    incident_name: incDef?.name ?? rep.incident_id,
    incident_severity: incDef?.severity,
    node_name: nodeDef?.name ?? rep.instance_id ?? 'the affected node',
    node_id: inst?.def_id ?? '',
    current_tier: inst?.tier,
    health: inst?.health,
    layer_name: layer?.name ?? nodeDef?.layer ?? '',
  }
}

/** Build context for a ticket from its requirement and current board state. */
export function buildTicketContext(
  state: GameState,
  ticketRecord: TicketRecord,
  catalog: EngineCatalog,
): TemplateContext {
  const def = (catalog as any).ticketById?.get(ticketRecord.ticket_id) as any
  if (!def) return {}
  const req = def.requirement ?? {}
  // Resolve the relevant instance: prefer node_id match, fall back to layers
  let inst = req.node_id
    ? state.instances.find((i: any) => i.def_id === req.node_id)
    : undefined
  if (!inst && Array.isArray(req.layers) && req.layers.length) {
    inst = state.instances.find((i: any) => {
      const nd = catalog.nodeById.get(i.def_id) as any
      return nd && req.layers.includes(nd.layer)
    })
  }
  const nodeDef = inst ? (catalog.nodeById.get(inst.def_id) as any) : undefined
  const targetTierNum: number | undefined =
    req.min_tier ?? (inst ? inst.tier + 1 : undefined)
  const tierDef = inst
    ? nodeDef?.tiers?.find((t: any) => t.tier === inst!.tier)
    : undefined
  const nextTierDef =
    nodeDef && targetTierNum
      ? nodeDef.tiers?.find((t: any) => t.tier === targetTierNum)
      : undefined
  const fmtCap = (t: any): string =>
    t ? `${t.stats.capacity} ${t.stats.capacity_unit}` : '—'
  return {
    node_name: nodeDef?.name ?? req.node_id ?? 'node',
    node_id: inst?.def_id ?? req.node_id ?? '',
    current_tier: inst?.tier,
    target_tier: targetTierNum,
    current_capacity: fmtCap(tierDef),
    target_capacity: fmtCap(nextTierDef),
    current_cost: tierDef?.stats?.cost_month,
    target_cost: nextTierDef?.stats?.cost_month,
    utilization_pct: inst ? Math.round(inst.utilization_pct) : undefined,
    health: inst?.health,
  }
}
