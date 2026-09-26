/* Minigame answer grading and outcome application.
   `gradeAnswer` is pure; `applyOutcome` builds a new GameState. */

import type { GameState, IncidentRecord } from './types'
import type { EngineCatalog } from './catalogFrom'
import { ledgerEntriesFor } from './ledger'
import { crossingTime } from './monitorCurve'

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

export interface GradeResult {
  readonly correct: boolean
  /** The wrong_outcomes[].when that matched, for showing the right message. */
  readonly when?: string
}

export function gradeAnswer(instanceDef: any, answer: MinigameAnswer): GradeResult {
  switch (answer.kind) {
    case 'ordered_sequence': {
      const correct =
        JSON.stringify(answer.order) === JSON.stringify(instanceDef.solution.order)
      return correct ? { correct: true } : { correct: false, when: 'wrong_order' }
    }

    case 'fill_blank': {
      const expected: Record<string, string> = instanceDef.solution.blanks
      const correct = Object.keys(expected).every((key) => {
        const expectedVal = expected[key].trim().toLowerCase()
        const givenVal = (answer.blanks[key] ?? '').trim().toLowerCase()
        return expectedVal === givenVal
      })
      return correct ? { correct: true } : { correct: false, when: 'wrong_value' }
    }

    case 'dial': {
      const expected: number = Number(instanceDef.solution.value)
      if (answer.value === expected) return { correct: true }
      return { correct: false, when: answer.value < expected ? 'below' : 'above' }
    }

    case 'wiring': {
      const expectedZone: string | null = instanceDef.solution.zone
      const expectedConnect: string[] = [...(instanceDef.solution.connect_to ?? [])].sort()
      const givenConnect = [...(answer.connectTo ?? [])].sort()
      const correct =
        answer.zone === expectedZone &&
        JSON.stringify(givenConnect) === JSON.stringify(expectedConnect)
      return correct ? { correct: true } : { correct: false, when: 'wrong_target' }
    }

    case 'evidence': {
      const correct = answer.choice === instanceDef.solution.choice
      return correct ? { correct: true } : { correct: false, when: 'wrong_choice' }
    }

    case 'terminal': {
      // Trailing quotes/semicolons that only close what the prefix opened are not
      // significant: `pg_stat_replication` and `pg_stat_replication";` are the same command.
      const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/["';\s]+$/, '')
      const accepts: string[] = instanceDef.solution.accepts
      const correct = accepts.map(norm).includes(norm(answer.text))
      return correct ? { correct: true } : { correct: false, when: 'wrong_command' }
    }

    case 'log_hunt': {
      // `accept` lists other lines that are the same root cause (e.g. every
      // occurrence of one slow query), so the player is not graded on which copy.
      const accept: number[] = instanceDef.solution.accept ?? []
      const correct = answer.line !== null &&
        (answer.line === instanceDef.solution.line || accept.includes(answer.line))
      return correct ? { correct: true } : { correct: false, when: 'wrong_line' }
    }

    case 'patch': {
      // Normalise for semantic comparison only; structural checks use trimEnd only.
      // Spacing around ':' and '=' is not significant ("pool:12" == "pool: 12").
      const norm = (s: string) =>
        s.trim().toLowerCase().replace(/\s*([:=])\s*/g, '$1').replace(/\s+/g, ' ')
      // Needles match on token boundaries, so "api 60" does not match "api 600".
      const has = (hay: string, needle: string) => {
        const esc = norm(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hay)
      }
      const origLines: string[] = (instanceDef.given.content as string).split('\n')
      const newLines: string[] = answer.content.split('\n')
      const targetIdx: number = (instanceDef.solution.line as number) - 1

      // Any change outside the target line, or a line count mismatch → collateral_edit
      if (newLines.length !== origLines.length) {
        return { correct: false, when: 'collateral_edit' }
      }
      for (let i = 0; i < origLines.length; i++) {
        if (i === targetIdx) continue
        if (newLines[i].trimEnd() !== origLines[i].trimEnd()) {
          return { correct: false, when: 'collateral_edit' }
        }
      }

      // Target line must contain every must_contain and none of must_not_contain
      const targetNorm = norm(newLines[targetIdx] ?? '')
      const mustContain: string[] = instanceDef.solution.must_contain ?? []
      const mustNotContain: string[] = instanceDef.solution.must_not_contain ?? []
      const containsAll = mustContain.every((s: string) => has(targetNorm, s))
      const containsNone = mustNotContain.every((s: string) => !has(targetNorm, s))
      if (containsAll && containsNone) return { correct: true }
      return { correct: false, when: 'wrong_edit' }
    }

    case 'monitor': {
      const { metrics, duration_s } = instanceDef.given
      const { metric: solutionMetric, threshold, direction, window_s } = instanceDef.solution
      // Find the solution metric's definition to compute tStar
      const m = (metrics as any[]).find((x) => x.id === solutionMetric)
      const tStar = m ? crossingTime(m, threshold, direction, duration_s) : null
      // Order matters: too_late is checked first (even wrong metric can be too late)
      if (tStar !== null && answer.t > tStar + window_s) return { correct: false, when: 'too_late' }
      if (answer.metric !== solutionMetric) return { correct: false, when: 'wrong_metric' }
      if (tStar === null || answer.t < tStar) return { correct: false, when: 'too_early' }
      return { correct: true }
    }

    case 'classify': {
      const expected: Record<string, string> = instanceDef.solution.bins
      const items: Array<{ id: string }> = instanceDef.given.items
      const correct = items.every(
        (item) => answer.placements[item.id] === expected[item.id],
      )
      return correct ? { correct: true } : { correct: false, when: 'wrong_bin' }
    }

    default: {
      // Exhaustiveness guard — unknown format is treated as wrong
      return { correct: false, when: 'wrong_choice' }
    }
  }
}

export function applyOutcome(
  state: GameState,
  params: {
    instanceId: string
    actionId: string
    minigameInstanceId: string
    /** null if this action resolves no incident */
    incidentKey: string | null
    correct: boolean
  },
  catalog: EngineCatalog,
): GameState {
  const { instanceId, actionId, minigameInstanceId, incidentKey, correct } = params

  const action = catalog.actionById.get(actionId)
  if (!action) throw new Error(`grading: unknown action id '${actionId}'`)

  const instIdx = state.instances.findIndex((i) => i.instance_id === instanceId)
  if (instIdx === -1) throw new Error(`grading: unknown instance id '${instanceId}'`)

  const inst = state.instances[instIdx]
  const outcome = correct ? action.on_success : action.on_fail

  // --- Apply health delta ---
  const healthDelta: number = outcome?.health_delta ?? 0
  const newHealth = Math.min(100, Math.max(0, inst.health + healthDelta))

  // --- Apply tags_add / tags_remove ---
  const tagsAdd: string[] = outcome?.tags_add ?? []
  const tagsRemove: string[] = outcome?.tags_remove ?? []
  const existingRuntime = new Set(inst.tags_runtime)
  for (const t of tagsAdd) existingRuntime.add(t)
  for (const t of tagsRemove) existingRuntime.delete(t)
  const newTagsRuntime = [...existingRuntime]

  // --- Apply cooldown ---
  const cooldownS: number = action.cooldown_s ?? 0
  const newCooldowns = { ...inst.action_cooldowns, [actionId]: cooldownS }

  // --- Apply tier_delta (upgrade_tier: advance to next tier on success) ---
  const tierDelta: number = correct ? (outcome?.tier_delta ?? 0) : 0
  const newTier = tierDelta > 0
    ? Math.min(inst.tier + tierDelta, 4)  // tier cap matches state.schema.json
    : inst.tier

  // --- Apply on_fail.metrics as utilisation spikes ---
  // metric keys like "error_rate_pct": "+1.0" represent how much the metric worsens.
  // error_rate_pct is driven by utilisation > 100%, so we translate the penalty to a
  // utilisation bump. uptime_pct deltas (negative) mean brief downtime — represented
  // as a moderate utilisation spike. This is approximate but visible to the player.
  // Apply on_fail.metrics as utilisation spikes
  let utilBump = 0
  if (!correct && outcome?.metrics) {
    const m = outcome.metrics as Record<string, string>
    const errDelta = m.error_rate_pct ? parseFloat(m.error_rate_pct) : 0
    const uptDelta = m.uptime_pct ? parseFloat(m.uptime_pct) : 0
    utilBump = errDelta * 2.5 + Math.abs(uptDelta) * 5
  }
  let newUtil = Math.max(0, inst.utilization_pct + utilBump)

  // Bug fix 1: when tier increases, scale utilization by old_capacity / new_capacity.
  // More capacity means the same absolute load is a smaller fraction of total.
  if (correct && tierDelta > 0 && newTier > inst.tier) {
    const def = catalog.nodeById.get(inst.def_id) as any
    const oldCap: number = def?.tiers?.find((t: any) => t.tier === inst.tier)?.stats?.capacity ?? 0
    const newCap: number = def?.tiers?.find((t: any) => t.tier === newTier)?.stats?.capacity ?? 0
    if (oldCap > 0 && newCap > oldCap) {
      newUtil = Math.max(0, newUtil * (oldCap / newCap))
    }
  }

  // Bug fix 2: stats_delta.capacity "+N%" reduces utilization proportionally.
  // Translates a capacity increase into the equivalent utilization reduction.
  if (correct) {
    const capDelta = (outcome?.stats_delta as Record<string, string> | undefined)?.capacity
    if (capDelta) {
      const m = capDelta.match(/^\+(\d+(?:\.\d+)?)%$/)
      if (m) {
        newUtil = Math.max(0, newUtil / (1 + parseFloat(m[1]) / 100))
      }
    }
  }

  // --- Reset `down` flag on successful resolution ---
  // An incident can set down:true (e.g. hardware_failure). A successful action
  // means the node is operational again — always clear down on success so the
  // node reappears in uptime_pct calculations.
  const newDown = correct ? false : inst.down

  // --- Build updated instance ---
  const newInst = {
    ...inst,
    health: newHealth,
    tier: newTier,
    down: newDown,
    utilization_pct: newUtil,
    tags_runtime: newTagsRuntime,
    action_cooldowns: newCooldowns,
  }

  const newInstances = [
    ...state.instances.slice(0, instIdx),
    newInst,
    ...state.instances.slice(instIdx + 1),
  ]

  // --- Apply cost_delta to budget ---
  const costDelta: number = outcome?.cost_delta ?? 0
  const newBudget = state.budget - costDelta

  // --- Update incident attempts ---
  let newIncidents = [...state.incidents]
  const incidentRecordIdx = incidentKey !== null
    ? newIncidents.findIndex((r) => r.key === incidentKey)
    : -1

  let newSession = state.session
  let newLedger = [...state.ledger]

  if (correct) {
    // One fix clears everything it fixes: the incident it was opened from (every
    // record of that key — a group incident has one per instance) plus any other
    // active incident on this instance that lists this action in resolved_by.
    const keys = new Set<string>()
    if (incidentRecordIdx !== -1) keys.add(newIncidents[incidentRecordIdx].key)
    for (const r of newIncidents) {
      if (r.instance_id !== instanceId) continue
      const def = catalog.incidentById.get(r.incident_id) as { resolved_by?: string[] } | undefined
      if (def?.resolved_by?.includes(actionId)) keys.add(r.key)
    }
    for (const key of keys) {
      const group = newIncidents.filter((r) => r.key === key)
      const incidentDef = catalog.incidentById.get(group[0].incident_id)
      if (incidentDef) {
        const affected = group.map((r) => r.instance_id).filter((id): id is string => id !== null)
        newLedger = [...newLedger, ...ledgerEntriesFor(incidentDef, 'on_resolve', state, catalog, affected.length ? affected : [instanceId])]
      }
    }
    if (keys.size > 0) {
      newIncidents = newIncidents.filter((r) => !keys.has(r.key))
      newSession = { ...state.session, incidents_resolved: state.session.incidents_resolved + keys.size }
    }
  } else if (incidentRecordIdx !== -1) {
    // Wrong answer — count the attempt, keep the incident
    const record = newIncidents[incidentRecordIdx]
    const currentAttempts = record.attempts[minigameInstanceId] ?? 0
    const updatedRecord: IncidentRecord = {
      ...record,
      attempts: { ...record.attempts, [minigameInstanceId]: currentAttempts + 1 },
    }
    newIncidents = [
      ...newIncidents.slice(0, incidentRecordIdx),
      updatedRecord,
      ...newIncidents.slice(incidentRecordIdx + 1),
    ]
  } else if (incidentKey === null && incidentRecordIdx === -1) {
    // No incident to resolve — just update attempts on any matching record
    // (no-op if there's no record for this minigame instance)
    // Still increment attempts if we can find a record with this minigame instance
    const anyRecordIdx = newIncidents.findIndex(
      (r) => r.instance_id === instanceId && minigameInstanceId in r.attempts,
    )
    if (anyRecordIdx !== -1) {
      const record = newIncidents[anyRecordIdx]
      const currentAttempts = record.attempts[minigameInstanceId] ?? 0
      newIncidents = [
        ...newIncidents.slice(0, anyRecordIdx),
        {
          ...record,
          attempts: { ...record.attempts, [minigameInstanceId]: currentAttempts + 1 },
        },
        ...newIncidents.slice(anyRecordIdx + 1),
      ]
    }
  }

  return {
    ...state,
    budget: newBudget,
    instances: newInstances,
    incidents: newIncidents,
    ledger: newLedger,
    session: newSession,
  }
}
