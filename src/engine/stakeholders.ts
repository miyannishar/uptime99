/* Stakeholder messages: which ones are due, and what a response does.
   Pure — the UI owns the real-time expiry timer and the choice of when to ask. */

import type { EngineCatalog } from './catalogFrom'
import type { GameState } from './types'

export interface StakeholderResponse {
  readonly label: string
  readonly reputation_delta: number
  readonly budget_delta: number
  readonly reply: string
}

export type StakeholderTrigger =
  | { readonly metric: string; readonly op: 'lt' | 'gt'; readonly value: number }
  | { readonly incident_severity_gte: number }

export interface StakeholderDef {
  readonly id: string
  readonly persona: string
  readonly name: string
  readonly trigger: StakeholderTrigger
  readonly text: string
  readonly expires_s: number
  readonly cooldown_ticks: number
  readonly responses: readonly StakeholderResponse[]
}

/** Latest recorded value of a metric — the same source metricsOf reads. */
function latest(state: GameState, metric: string): number | undefined {
  const series = (state.history as Record<string, readonly number[]>)[metric]
  return series && series.length ? series[series.length - 1] : undefined
}

function holds(state: GameState, catalog: EngineCatalog, t: StakeholderTrigger): boolean {
  if ('incident_severity_gte' in t) {
    return state.incidents.some((r) => {
      const def = catalog.incidentById.get(r.incident_id) as { severity?: number } | undefined
      return (def?.severity ?? 0) >= t.incident_severity_gte
    })
  }
  const v = latest(state, t.metric)
  if (v === undefined) return false
  return t.op === 'gt' ? v > t.value : v < t.value
}

/** Messages whose trigger holds now and whose cooldown since last shown has passed. */
export function dueStakeholderMessages(
  state: GameState,
  catalog: EngineCatalog,
  lastShownTick: Readonly<Record<string, number>>,
): StakeholderDef[] {
  const defs = ((catalog as any).stakeholders ?? []) as StakeholderDef[]
  return defs.filter((d) => {
    const last = lastShownTick[d.id]
    if (last !== undefined && state.tick - last < d.cooldown_ticks) return false
    return holds(state, catalog, d.trigger)
  })
}

/** Apply a response: reputation clamped to [0, 100]; budget moves freely, as with action costs. */
export function applyStakeholderResponse(
  state: GameState,
  delta: { readonly reputation_delta: number; readonly budget_delta: number },
): GameState {
  const reputation = Math.min(100, Math.max(0, state.carried.reputation + delta.reputation_delta))
  return {
    ...state,
    budget: state.budget + delta.budget_delta,
    carried: { ...state.carried, reputation },
  }
}

/** The response applied when a message expires unanswered: the worst for reputation. */
export function ignoredResponse(def: StakeholderDef): StakeholderResponse {
  return [...def.responses].sort((a, b) => a.reputation_delta - b.reputation_delta)[0]
}
