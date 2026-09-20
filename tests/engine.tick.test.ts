import { describe, it, expect } from 'vitest'
import { loadEngineCatalog, catalogFrom } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { advance } from '../src/engine/tick'
import { HISTORY_WINDOW, type GameState, type IncidentRecord } from '../src/engine/types'

const c = loadEngineCatalog()
const run = (over: Partial<GameState> = {}): GameState =>
  ({ ...loadScenario('slice-oom-kill', c), phase: 'run', rng_seed: 4242, ...over }) as GameState

describe('advance — the clock', () => {
  it('advances the tick by one', () => {
    expect(advance(run(), 1, c).tick).toBe(1)
  })

  it('advances by dtTicks', () => {
    expect(advance(run(), 12, c).tick).toBe(12)
  })

  it('loops rather than multiplying, so twelve single ticks equal one dt=12 call', () => {
    let s = run()
    for (let i = 0; i < 12; i += 1) s = advance(s, 1, c)
    expect(s).toEqual(advance(run(), 12, c))
  })

  it('never mutates the input state', () => {
    const s = run()
    const before = structuredClone(s)
    advance(s, 5, c)
    expect(s).toEqual(before)
  })

  it('is deterministic for a seed', () => {
    expect(advance(run(), 80, c)).toEqual(advance(run(), 80, c))
  })

  // NOTE: there is deliberately no "differs for a different seed" test here.
  // The shipped scenario is `scripted`, so arrivals come from its authored
  // schedule and ignore the rng entirely — see the seed-independence test in the
  // scripted block below. The weighted path's determinism is covered directly in
  // tests/engine.arrival.test.ts, and cannot be reached through advance until a
  // weighted scenario exists.
})

describe('advance — arrivals', () => {
  // The one shipped scenario is `scripted`, and the catalogue is frozen, so the
  // weighted arrival path cannot be reached through `advance` here. It is covered
  // directly in tests/engine.arrival.test.ts via shouldArrive and selectIncident.
  // What this block asserts is everything arrival-independent: concurrency,
  // last_fired, and that the board actually degrades.
  it('fires the scheduled incident within the window', () => {
    const out = advance(run(), 40, c)
    expect(out.session.incidents_fired).toBeGreaterThan(0)
  })

  it('weighted arrivals respect max_concurrent', () => {
    // The max_concurrent cap applies ONLY to the weighted arrival path; scripted
    // arrivals ignore it (see "scripted arrivals fire regardless" test below).
    // Build a catalogue whose only scenario uses incident_source: 'weighted' so the
    // cap is exercised — the slice-oom-kill board's level 1 sets max_concurrent: 1.
    const realScenario = c.scenarioById.get('slice-oom-kill')!
    const cat = catalogFrom({
      nodes: [...c.nodes], layers: [...c.layers], tags: [...c.tags],
      actions: [...c.actions], metrics: [...c.metrics], economy: c.economy,
      incidents: [...c.incidents], formats: [...c.formats],
      minigames: [...c.minigames], minigameInstances: [...c.minigameInstances],
      levels: [...c.levels],
      scenarios: [{ ...realScenario, id: 'weighted-cap-test',
        incident_source: 'weighted', incidents: [],
        end: { kind: 'fixed_window', ticks: 400 } }],
    })
    let s = { ...run(), scenario_id: 'weighted-cap-test' } as GameState
    for (let i = 0; i < 400; i += 1) {
      s = advance(s, 1, cat)
      // level 1 max_concurrent: 1 — the weighted path must respect it
      expect(s.incidents.length).toBeLessThanOrEqual(1)
    }
  })

  it('records last_fired so cooldowns can be enforced', () => {
    const out = advance(run(), 300, c)
    expect(Object.keys(out.last_fired).length).toBeGreaterThan(0)
    for (const t of Object.values(out.last_fired)) expect(t).toBeLessThanOrEqual(out.tick)
  })

  it('degrades the board once something has fired', () => {
    const out = advance(run(), 300, c)
    const damaged = out.instances.some((i) => i.health < 100 || i.utilization_pct > 0 || i.down)
    expect(damaged).toBe(true)
  })

  it('applies arrival damage once, not every tick', () => {
    // find the tick an incident first appears, then check health stops falling
    let s = run()
    let firstSeen = -1
    for (let i = 0; i < 400 && firstSeen < 0; i += 1) {
      s = advance(s, 1, c)
      if (s.incidents.length > 0) firstSeen = s.tick
    }
    expect(firstSeen).toBeGreaterThan(0)
    const healthAt = (st: GameState) =>
      st.instances.reduce((a, i) => a + i.health, 0)
    const h1 = healthAt(s)
    const later = advance(s, 5, c)
    // slice-oom-kill schedules exactly one incident; max_concurrent=1 means no second
    // arrival can fire while the first is still active — the precondition is
    // deterministic, so asserting it turns a silent skip into a real failure.
    expect(later.session.incidents_fired).toBe(s.session.incidents_fired)
    expect(healthAt(later)).toBe(h1)
  })
})

describe('advance — scripted arrivals', () => {
  it('fires the authored incident on its scheduled tick, not before', () => {
    // slice-oom-kill is scripted: oom_kill at tick 12
    const before = advance(run(), 11, c)
    expect(before.incidents).toHaveLength(0)
    const after = advance(run(), 12, c)
    expect(after.incidents.map((i) => i.incident_id)).toEqual(['oom_kill'])
    expect(after.session.incidents_fired).toBe(1)
  })

  it('fires nothing else for the rest of a scripted window', () => {
    const out = advance(run(), 40, c)
    expect(out.session.incidents_fired).toBe(1)
  })

  it('schedules arrivals from the authored timetable, so arrival timing is seed-independent', () => {
    // NOTE: victim *selection* still consumes the rng via affectedInstanceIds, so a
    // scripted run is seed-independent in arrival *timing* only — a multi-target
    // incident would pick different victims per seed. The assertion is on incident keys
    // (timing), not the full state, which is intentional.
    const a = advance(run({ rng_seed: 1 }), 20, c)
    const b = advance(run({ rng_seed: 999 }), 20, c)
    expect(a.incidents.map((i) => i.key)).toEqual(b.incidents.map((i) => i.key))
  })

  it('damages the board at the scheduled tick', () => {
    const out = advance(run(), 12, c)
    const app = out.instances.find((i) => i.instance_id === 'app-cluster-1')!
    expect(app.health).toBeLessThan(100)
  })

  it('records last_fired for a scripted arrival too', () => {
    expect(advance(run(), 12, c).last_fired.oom_kill).toBe(12)
  })

  it('scripted arrivals fire regardless of active incident count', () => {
    // Saturate max_concurrent=1 with a pre-existing incident. slice-oom-kill
    // schedules oom_kill at tick 12; without the fix, the max_concurrent guard
    // around the arrival block would silently discard it.
    const preexisting: IncidentRecord[] = [{
      key: 'hardware_failure#1',
      incident_id: 'hardware_failure',
      instance_id: 'app-cluster-1',
      started_tick: 0,
      escalate_at_tick: null,
      expires_at_tick: null,
      attempts: {},
    }]
    const s = run({ incidents: preexisting })
    const out = advance(s, 12, c)
    expect(out.incidents.map((i) => i.incident_id)).toContain('oom_kill')
  })

  it('group-scope arrival creates one record per affected instance sharing one key', () => {
    // az_outage is group scope (group_by: region). The slice board puts app-cluster-1
    // (compute, single_az) and postgres-1 (data, single_az) in the same region.
    // Both match the az_outage constraint, so both should receive a record.
    const realScenario = c.scenarioById.get('slice-oom-kill')!
    const cat = catalogFrom({
      nodes: [...c.nodes], layers: [...c.layers], tags: [...c.tags],
      actions: [...c.actions], metrics: [...c.metrics], economy: c.economy,
      incidents: [...c.incidents], formats: [...c.formats],
      minigames: [...c.minigames], minigameInstances: [...c.minigameInstances],
      levels: [...c.levels],
      scenarios: [{ ...realScenario, id: 'az-test',
        incidents: [{ incident_id: 'az_outage', at_tick: 1 }] }],
    })
    const s = {
      ...loadScenario('slice-oom-kill', c),
      phase: 'run' as const,
      rng_seed: 42,
      scenario_id: 'az-test',
    }
    const out = advance(s, 1, cat)
    const recs = out.incidents.filter((r) => r.incident_id === 'az_outage')
    // Group scope → multiple records, one per affected instance in the chosen group
    expect(recs.length).toBeGreaterThan(1)
    // All records from the same arrival share one key
    expect(new Set(recs.map((r) => r.key)).size).toBe(1)
    // Each record identifies the specific instance it covers
    expect(recs.every((r) => r.instance_id !== null)).toBe(true)
  })
})

describe('advance — per-tick ledger', () => {
  it('accrues one per_tick ledger entry per tick per active incident', () => {
    // hardware_failure has one per_tick event: {kind:'sla_credit', basis:'affected_users * credit_rate'}
    // Compute the expected growth from the incident definition so the test survives a data change.
    const hwFail = c.incidents.find((i: any) => i.id === 'hardware_failure')!
    const perTickCount = hwFail.ledger_events.filter((e: any) => e.when === 'per_tick').length
    // perTickCount === 1 at the time of writing; derived above so a data change fails loudly.
    const incidents: IncidentRecord[] = [{
      key: 'hardware_failure#1',
      incident_id: 'hardware_failure',
      instance_id: 'app-cluster-1',
      started_tick: 0,
      escalate_at_tick: null,
      expires_at_tick: null,
      attempts: {},
    }]
    const s = run({ incidents })
    const before = s.ledger.length
    const after = advance(s, 3, c)
    // Exactly 3 ticks × perTickCount events each tick — not 0 (step 2 has teeth)
    // and not 3*n where n > 1 unless hardware_failure gains more per_tick events.
    expect(after.ledger.length - before).toBe(3 * perTickCount)
  })

  it('groups per_tick ledger by key so a group incident charges once with combined ids', () => {
    // Simulate a group arrival: two records sharing one key, different instance_ids.
    // hardware_failure has a per_tick ledger event; without the fix (iterating per
    // record) we would get 2 × perTickCount entries instead of perTickCount.
    const hwFail = c.incidents.find((i: any) => i.id === 'hardware_failure')!
    const perTickCount = hwFail.ledger_events.filter((e: any) => e.when === 'per_tick').length
    const incidents: IncidentRecord[] = [
      { key: 'hardware_failure#1', incident_id: 'hardware_failure',
        instance_id: 'app-cluster-1', started_tick: 0,
        escalate_at_tick: null, expires_at_tick: null, attempts: {} },
      { key: 'hardware_failure#1', incident_id: 'hardware_failure',
        instance_id: 'postgres-1', started_tick: 0,
        escalate_at_tick: null, expires_at_tick: null, attempts: {} },
    ]
    const s = run({ incidents })
    const before = s.ledger.length
    const after = advance(s, 1, c)
    // One key-group → perTickCount, not 2 × perTickCount
    expect(after.ledger.length - before).toBe(perTickCount)
  })

  it('does not accrue a ledger entry for an incident with no per_tick event', () => {
    // oom_kill only has an on_resolve event — no per_tick events.
    // This negative case proves the filter works rather than every timing being appended.
    const incidents: IncidentRecord[] = [{
      key: 'oom_kill#1',
      incident_id: 'oom_kill',
      instance_id: 'app-cluster-1',
      started_tick: 0,
      escalate_at_tick: null,
      expires_at_tick: null,
      attempts: {},
    }]
    const s = run({ incidents })
    const before = s.ledger.length
    // max_concurrent=1 and one incident already active, so no new arrival can fire.
    const after = advance(s, 3, c)
    expect(after.ledger.length).toBe(before)
  })

  it('prices per_tick entries as charges with the tick stamped', () => {
    // From the same hardware_failure state as the first test: verify entry shape.
    const incidents: IncidentRecord[] = [{
      key: 'hardware_failure#1',
      incident_id: 'hardware_failure',
      instance_id: 'app-cluster-1',
      started_tick: 0,
      escalate_at_tick: null,
      expires_at_tick: null,
      attempts: {},
    }]
    const s = run({ incidents })
    const startTick = s.tick  // 0 — loaded from loadScenario which initialises tick: 0
    const endTick = startTick + 3
    const after = advance(s, 3, c)
    const newEntries = after.ledger.slice(s.ledger.length)
    expect(newEntries.length).toBeGreaterThan(0)
    for (const e of newEntries) {
      expect(e.amount).toBeLessThan(0)            // strictly negative — these are charges
      expect(e.cadence).toBe('once')              // per_tick is a fresh one-off, not a standing monthly line
      expect(e.tick).toBeGreaterThanOrEqual(startTick + 1)
      expect(e.tick).toBeLessThanOrEqual(endTick)
    }
  })

  it('every ledger amount is a charge', () => {
    // Use hardware_failure (has a per_tick event) so the ledger is populated.
    // Assert count first — an empty loop is the original defect (oom_kill has only
    // an on_resolve event and never resolves, so advance(run(), 300).ledger is empty).
    const incidents: IncidentRecord[] = [{
      key: 'hardware_failure#1',
      incident_id: 'hardware_failure',
      instance_id: 'app-cluster-1',
      started_tick: 0,
      escalate_at_tick: null,
      expires_at_tick: null,
      attempts: {},
    }]
    const s = run({ incidents })
    const after = advance(s, 3, c)
    const newEntries = after.ledger.slice(s.ledger.length)
    expect(newEntries.length).toBeGreaterThan(0)  // fails if loop body never executes
    for (const e of newEntries) expect(e.amount).toBeLessThan(0)
  })
})

describe('advance — metrics and history', () => {
  it('appends one history sample per tick', () => {
    const out = advance(run(), 10, c)
    expect(out.history.p95_latency_ms).toHaveLength(10)
  })

  it('bounds history to HISTORY_WINDOW', () => {
    const out = advance(run(), HISTORY_WINDOW + 40, c)
    expect(out.history.p95_latency_ms!.length).toBeLessThanOrEqual(HISTORY_WINDOW)
  })

  it('tracks peak p95 and never lowers it', () => {
    // Inject a peak of 500 — well above the run's actual p95 of 72. After one tick,
    // Math.max(500, 72) must still be 500. Without Math.max the previous peak would
    // be overwritten and the test fails immediately.
    const s = run({
      session: { peak_p95_ms: 500, incidents_fired: 0, incidents_resolved: 0, status: 'running' },
    })
    const after = advance(s, 1, c)
    expect(after.session.peak_p95_ms).toBe(500)
  })

  it('carries reputation and users forward rather than recomputing from scratch', () => {
    // oom_kill fires at tick 12 and stays active; reputation decays by 4.5 per tick
    // (decay_per_tick=1.5 × severity=3). Chained carry-forward reaches 0 after ~22
    // active ticks. A stub that resets carried.reputation to 100 each tick (ignoring
    // the previous value) would give ≈ 95.5 every tick rather than 0 at tick 60.
    const out = advance(run(), 60, c)
    // carried must equal the final history entry — the carry-forward relationship
    expect(out.carried.reputation).toBe(out.history.reputation!.at(-1)!)
    // reputation must have fallen from its pre-incident level
    expect(out.history.reputation!.at(-1)!).toBeLessThan(out.history.reputation![0])
    // chained decay gives 0 at tick 60; a from-scratch stub would give ≈ 95.5
    expect(out.carried.reputation).toBeLessThan(50)
  })

  it('drops reputation while an incident is active', () => {
    let s = run()
    for (let i = 0; i < 400; i += 1) {
      s = advance(s, 1, c)
      if (s.incidents.length > 0) break
    }
    // slice-oom-kill fires oom_kill at tick 12; the loop always finds it well before
    // 400 ticks — asserting the precondition turns a silent skip into an explicit failure.
    expect(s.incidents.length).toBeGreaterThan(0)
    const after = advance(s, 3, c)
    expect(after.carried.reputation).toBeLessThan(100)
  })
})

describe('advance — expiry and escalation', () => {
  it('removes an incident when its duration elapses', () => {
    const survive = c.incidents.find((i: any) => i.duration_ticks)!
    const s = run({
      tick: 10,
      incidents: [{
        key: `${survive.id}#1`, incident_id: survive.id, instance_id: null,
        started_tick: 10, escalate_at_tick: null,
        expires_at_tick: 10 + survive.duration_ticks, attempts: {},
      }],
    })
    const out = advance(s, survive.duration_ticks + 1, c)
    expect(out.incidents.map((i) => i.key)).not.toContain(`${survive.id}#1`)
  })

  it('emits on_expire ledger entries when an incident expires', () => {
    const withExpiry = c.incidents.find((i: any) =>
      i.duration_ticks && i.ledger_events.some((e: any) => e.when === 'on_expire'))
    if (!withExpiry) return
    // Derive counts from the incident definition so a data change fails loudly.
    const onExpireEvents = withExpiry.ledger_events.filter((e: any) => e.when === 'on_expire')
    const onExpireKinds = new Set(onExpireEvents.map((e: any) => e.kind as string))
    // The per_tick events and on_expire events for this incident use different `kind` values
    // (e.g. sla_credit vs incident_remediation), so filtering by kind isolates the
    // on_expire entries from the per_tick noise across the whole run.
    const s = run({
      tick: 5,
      incidents: [{
        key: `${withExpiry.id}#1`, incident_id: withExpiry.id, instance_id: null,
        started_tick: 5, escalate_at_tick: null,
        expires_at_tick: 5 + withExpiry.duration_ticks, attempts: {},
      }],
    })
    const out = advance(s, withExpiry.duration_ticks + 1, c)
    const onExpireLedger = out.ledger.filter((e) => onExpireKinds.has(e.kind))
    // Exactly as many on_expire entries as the incident declares — not 0
    // (step 4 has teeth: deleting the on_expire push would drop this to 0),
    // and not inflated by per_tick entries from earlier ticks.
    expect(onExpireLedger.length).toBe(onExpireEvents.length)
  })

  it('replaces an incident with its escalation target at the threshold', () => {
    const esc = c.incidents.find((i: any) => i.escalates_to && i.escalate_after_ticks)!
    const s = run({
      tick: 10,
      incidents: [{
        key: `${esc.id}#1`, incident_id: esc.id, instance_id: 'app-cluster-1',
        started_tick: 10, escalate_at_tick: 10 + esc.escalate_after_ticks,
        expires_at_tick: null, attempts: {},
      }],
    })
    const out = advance(s, esc.escalate_after_ticks + 1, c)
    expect(out.incidents.map((i) => i.incident_id)).toContain(esc.escalates_to)
    expect(out.incidents.map((i) => i.incident_id)).not.toContain(esc.id)
  })

  it('escalation into architecture scope clears instance_id to null', () => {
    // data_breach (instance scope) escalates to gdpr_breach_notification (architecture scope).
    // The escalated record must not carry the postgres-1 instance_id from the source incident.
    const dataBreach = c.incidentById.get('data_breach')!
    const toId = dataBreach.escalates_to as string
    const gdpr = c.incidentById.get(toId)!
    expect(gdpr.scope).toBe('architecture')
    const s = run({
      tick: 10,
      incidents: [{
        key: 'data_breach#1',
        incident_id: 'data_breach',
        instance_id: 'postgres-1',
        started_tick: 10,
        escalate_at_tick: 10 + (dataBreach.escalate_after_ticks as number),
        expires_at_tick: null,
        attempts: {},
      }],
    })
    const out = advance(s, (dataBreach.escalate_after_ticks as number) + 1, c)
    const escalated = out.incidents.find((r) => r.incident_id === toId)
    expect(escalated).toBeDefined()
    expect(escalated!.instance_id).toBeNull()
  })

  it('applies escalation damage to the record instance_id at the escalation tick', () => {
    // replication_lag_spike → data_loss_incident: health_delta -90, down: true.
    // replication_lag_spike targets nodes with has_replica, which no tier on the
    // slice board carries — the test uses app-cluster-1 directly for the instance_id,
    // which is valid because escalation damage lands on rec.instance_id regardless of
    // whether that instance matches the escalation target's constraint.
    // Start at tick 15 (past the scripted oom_kill at tick 12) so the arrival fix
    // for finding 3 does not apply damage to app-cluster-1 before escalation does.
    const from = c.incidentById.get('replication_lag_spike')!
    const to = c.incidentById.get(from.escalates_to!)!
    const instanceId = 'app-cluster-1'
    const s = run({
      tick: 15,
      incidents: [{
        key: 'replication_lag_spike#1',
        incident_id: 'replication_lag_spike',
        instance_id: instanceId,
        started_tick: 15,
        escalate_at_tick: 15 + from.escalate_after_ticks,
        expires_at_tick: null,
        attempts: {},
      }],
    })
    const beforeHealth = s.instances.find((i) => i.instance_id === instanceId)!.health
    const out = advance(s, from.escalate_after_ticks + 1, c)
    const inst = out.instances.find((i) => i.instance_id === instanceId)!
    // Derive the expected delta from the catalog so a data change fails loudly.
    // beforeHealth is 100 because we start past tick 12 (no prior oom_kill damage).
    const expectedHealth = Math.max(0, beforeHealth + to.damage.health_delta)
    expect(inst.health).toBe(expectedHealth)
    expect(inst.down).toBe(true)
  })
})
