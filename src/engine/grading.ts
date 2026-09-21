/* Minigame answer grading and outcome application.
   `gradeAnswer` is pure; `applyOutcome` builds a new GameState. */

import type { GameState, IncidentRecord } from './types'
import type { EngineCatalog } from './catalogFrom'
import { ledgerEntriesFor } from './ledger'

export type MinigameAnswer =
  | { readonly kind: 'ordered_sequence'; readonly order: readonly number[] }
  | { readonly kind: 'fill_blank'; readonly blanks: Readonly<Record<string, string>> }
  | { readonly kind: 'dial'; readonly value: number }
  | { readonly kind: 'wiring'; readonly zone: string | null; readonly connectTo: readonly string[] }
  | { readonly kind: 'evidence'; readonly choice: string | null }

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
      const expected: number = instanceDef.solution.value
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

  if (incidentRecordIdx !== -1) {
    const record = newIncidents[incidentRecordIdx]
    const currentAttempts = record.attempts[minigameInstanceId] ?? 0
    const updatedRecord: IncidentRecord = {
      ...record,
      attempts: {
        ...record.attempts,
        [minigameInstanceId]: currentAttempts + 1,
      },
    }

    if (correct) {
      // Find the incident definition to emit on_resolve ledger entries
      const incidentDef = catalog.incidentById.get(record.incident_id)
      if (incidentDef) {
        const resolveEntries = ledgerEntriesFor(
          incidentDef,
          'on_resolve',
          state,
          catalog,
          [instanceId],
        )
        newLedger = [...newLedger, ...resolveEntries]
      }

      // Remove the resolved incident
      newIncidents = [
        ...newIncidents.slice(0, incidentRecordIdx),
        ...newIncidents.slice(incidentRecordIdx + 1),
      ]

      // Increment incidents_resolved
      newSession = {
        ...state.session,
        incidents_resolved: state.session.incidents_resolved + 1,
      }
    } else {
      // Wrong answer — update attempts but keep incident
      newIncidents = [
        ...newIncidents.slice(0, incidentRecordIdx),
        updatedRecord,
        ...newIncidents.slice(incidentRecordIdx + 1),
      ]
    }
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
