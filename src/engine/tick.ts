import { rngFrom } from './rng'
import { difficultyFor } from './difficulty'
import { shouldArrive, selectIncident } from './arrival'
import { affectedInstanceIds, applyDamage } from './damage'
import { ledgerEntriesFor } from './ledger'
import { deriveMetrics } from './metrics'
import { scenarioById } from './scenario'
import type { EngineCatalog } from './catalog'
import {
  HISTORY_WINDOW, METRIC_IDS,
  type GameState, type IncidentRecord, type LedgerEntry, type MetricId,
} from './types'

/**
 * A well-mixed starting position for the RNG. Raw seed 1 is pathological for
 * xorshift32: its first draw is ~6.3e-5, so nextInt(rng, n) returns 0 and
 * shouldArrive fires on tick 1 for every weighted run. `rngFrom` applies a
 * splitmix32 finaliser so the stream starts in a well-distributed state.
 * `advance` uses this when `state.rng_seed` is null, treating the seed as an
 * already-advanced stream position — calling `rngFrom` on every tick would
 * re-scramble twelve times during a dt=12 call but only once for twelve dt=1
 * calls, breaking the looping equivalence test.
 */
const DEFAULT_RNG_SEED = rngFrom(1).seed

/**
 * Create one IncidentRecord per affected instance (group scope) or a single
 * record for instance and architecture scope. All records from the same arrival
 * share one key so metrics.ts can deduplicate incident_severity correctly
 * (dedup by key means a group-scope incident spanning n nodes counts once).
 */
function makeRecords(
  inc: any,
  ids: readonly string[],
  fired: number,
  tick: number,
): IncidentRecord[] {
  const key = `${inc.id}#${fired + 1}`
  const base = {
    key,
    incident_id: inc.id as string,
    started_tick: tick,
    escalate_at_tick: (inc.escalate_after_ticks as number | null)
      ? tick + (inc.escalate_after_ticks as number) : null,
    expires_at_tick: (inc.duration_ticks as number | null)
      ? tick + (inc.duration_ticks as number) : null,
    attempts: {} as Record<string, number>,
  }
  if (ids.length > 1) {
    // Group scope: one record per affected instance, all sharing the same key.
    return ids.map((id) => ({ ...base, instance_id: id }))
  }
  // Instance scope (1 id) or architecture/no-match (0 ids).
  return [{ ...base, instance_id: ids.length === 1 ? ids[0] : null }]
}

/** Group incident records by key. Preserves insertion order within each group. */
function groupByKey(records: readonly IncidentRecord[]): Map<string, IncidentRecord[]> {
  const map = new Map<string, IncidentRecord[]>()
  for (const r of records) {
    const group = map.get(r.key) ?? []
    group.push(r)
    map.set(r.key, group)
  }
  return map
}

/**
 * One tick. The order is spec §3.1 and the steps read each other, so it is not
 * rearrangeable: metrics derive last because steps 1-5 change what they read,
 * and reputation needs the incident set for this tick since incident_severity is
 * summed rather than stored.
 */
function oneTick(state: GameState, catalog: EngineCatalog): GameState {
  const scenario = scenarioById(state.scenario_id, catalog)
  const difficulty = difficultyFor(scenario, catalog)
  const tick = state.tick + 1
  let rng = { seed: state.rng_seed ?? DEFAULT_RNG_SEED }
  let instances = state.instances
  let incidents: IncidentRecord[] = [...state.incidents]
  const ledger: LedgerEntry[] = [...state.ledger]
  const lastFired: Record<string, number> = { ...state.last_fired }
  let fired = state.session.incidents_fired

  // 1. arrivals — branch on incident_source; the two paths never both run.
  //    Scripted: the author stated when, so no roll, no pacing, no max_concurrent
  //    gate (spec §5.2). filter handles multiple incidents authored at the same tick.
  //    Weighted: max_concurrent bounds random arrival pacing only.
  if (scenario.incident_source === 'scripted') {
    const due = (scenario.incidents ?? []).filter((e: any) => e.at_tick === tick)
    for (const entry of due) {
      const inc = catalog.incidentById.get(entry.incident_id) ?? null
      if (!inc) {
        throw new Error(
          `tick: scenario '${scenario.id}' schedules unknown incident '${entry.incident_id}' at ` +
          `tick ${tick}`,
        )
      }
      const hit = affectedInstanceIds(inc, { ...state, tick, instances }, catalog, rng)
      rng = hit.rng
      instances = applyDamage({ ...state, instances }, inc, hit.ids).instances
      incidents = [...incidents, ...makeRecords(inc, hit.ids, fired, tick)]
      lastFired[inc.id] = tick
      fired += 1
    }
  } else {
    if (incidents.length < difficulty.max_concurrent) {
      const roll = shouldArrive(difficulty, rng)
      rng = roll.rng
      if (roll.arrive) {
        const pick = selectIncident({ ...state, tick }, catalog, difficulty, rng)
        rng = pick.rng
        if (pick.incident) {
          const inc = pick.incident
          const hit = affectedInstanceIds(inc, { ...state, tick, instances }, catalog, rng)
          rng = hit.rng
          instances = applyDamage({ ...state, instances }, inc, hit.ids).instances
          incidents = [...incidents, ...makeRecords(inc, hit.ids, fired, tick)]
          lastFired[inc.id] = tick
          fired += 1
        }
      }
    }
  }

  // 2. per-tick ledger for everything still active — group by key so a group
  //    incident emits one ledger set with the full affected-instance list, not
  //    one set per record (which would multiply affected_instances × n and
  //    overcharge incidents that price by affected_instances, e.g. ddos_attack).
  for (const recs of groupByKey(incidents).values()) {
    const inc = catalog.incidentById.get(recs[0].incident_id)
    if (!inc) continue
    const ids = recs.flatMap((r) => r.instance_id ? [r.instance_id] : [])
    ledger.push(...ledgerEntriesFor(inc, 'per_tick', { ...state, tick }, catalog, ids))
  }

  // 3. escalations — grouped by key so a key-group (group-scope incident) escalates
  //    as a unit, applying escalated damage to all its instances at once.
  //    Architecture-scope targets clear instance_id to null and collapse the
  //    key-group to one record (CLAUDE.md §13: a design gap is not bound to a
  //    specific node). No rng is consumed: re-drawing would change seeded streams
  //    and produce instance_id mismatches with the node that took damage.
  const escalatedIncidents: IncidentRecord[] = []
  for (const keyGroup of groupByKey(incidents).values()) {
    const rep = keyGroup[0]
    if (rep.escalate_at_tick === null || tick < rep.escalate_at_tick) {
      escalatedIncidents.push(...keyGroup)
      continue
    }
    const from = catalog.incidentById.get(rep.incident_id)
    const toId = from?.escalates_to as string | undefined
    const to = toId ? catalog.incidentById.get(toId) : undefined
    if (!toId || !to) {
      escalatedIncidents.push(...keyGroup)
      continue
    }
    if (to.scope !== 'architecture') {
      const ids = keyGroup.flatMap((r) => r.instance_id ? [r.instance_id] : [])
      instances = applyDamage({ ...state, instances }, to, ids).instances
    }
    lastFired[toId] = tick
    if (to.scope === 'architecture') {
      // Architecture scope: collapse key-group to one record with instance_id: null.
      escalatedIncidents.push({
        ...rep,
        incident_id: toId,
        instance_id: null,
        escalate_at_tick: to.escalate_after_ticks ? tick + to.escalate_after_ticks : null,
        expires_at_tick: to.duration_ticks ? tick + to.duration_ticks : null,
      })
    } else {
      for (const r of keyGroup) {
        escalatedIncidents.push({
          ...r,
          incident_id: toId,
          escalate_at_tick: to.escalate_after_ticks ? tick + to.escalate_after_ticks : null,
          expires_at_tick: to.duration_ticks ? tick + to.duration_ticks : null,
        })
      }
    }
  }
  incidents = escalatedIncidents

  // 4. expiries — grouped by key so a group incident emits one on_expire set with
  //    the full affected-instance list. All records in a key-group share the same
  //    expires_at_tick (authored at the same tick from the same incident).
  const expiredKeys = new Set<string>()
  for (const [key, recs] of groupByKey(incidents)) {
    const rep = recs[0]
    if (rep.expires_at_tick === null || tick < rep.expires_at_tick) continue
    expiredKeys.add(key)
    const inc = catalog.incidentById.get(rep.incident_id)
    if (!inc) continue
    const ids = recs.flatMap((r) => r.instance_id ? [r.instance_id] : [])
    ledger.push(...ledgerEntriesFor(inc, 'on_expire', { ...state, tick }, catalog, ids))
  }
  incidents = incidents.filter((r) => !expiredKeys.has(r.key))

  // 5. cooldowns
  instances = instances.map((inst) => {
    const entries = Object.entries(inst.action_cooldowns)
    if (entries.length === 0) return inst
    const next: Record<string, number> = {}
    for (const [id, left] of entries) {
      const remaining = left - catalog.economy.tick_seconds
      if (remaining > 0) next[id] = remaining
    }
    return { ...inst, action_cooldowns: next }
  })

  // 6. metrics — last, because 1-5 changed what they read
  const mid: GameState = {
    ...state, tick, instances, incidents, ledger, last_fired: lastFired, rng_seed: rng.seed,
  }
  const metrics = deriveMetrics(mid, catalog)

  // 7. history and bookkeeping
  const history: Partial<Record<MetricId, number[]>> = {}
  for (const id of METRIC_IDS) {
    const prev = mid.history[id] ?? []
    history[id] = [...prev, metrics[id]].slice(-HISTORY_WINDOW)
  }

  return {
    ...mid,
    carried: { reputation: metrics.reputation, users: metrics.users },
    history,
    session: {
      ...mid.session,
      peak_p95_ms: Math.max(mid.session.peak_p95_ms, metrics.p95_latency_ms),
      incidents_fired: fired,
    },
  }
}

/**
 * Advance the clock. dtTicks loops rather than scaling: multiplying a single
 * tick's effects would skip escalation thresholds, land expiries on the wrong
 * tick, and fire per-tick ledger events once instead of dtTicks times.
 */
export function advance(state: GameState, dtTicks: number, catalog: EngineCatalog): GameState {
  if (state.phase !== 'run') {
    throw new Error(`advance: the clock only runs in the run phase, got '${state.phase}'`)
  }
  if (!Number.isInteger(dtTicks) || dtTicks < 1) {
    throw new Error(`advance: dtTicks must be a positive integer, got ${dtTicks}`)
  }
  let s = state
  for (let i = 0; i < dtTicks; i += 1) s = oneTick(s, catalog)
  return s
}
