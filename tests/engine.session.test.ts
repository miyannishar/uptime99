import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { catalogFrom } from '../src/engine/catalogFrom'
import { loadScenario } from '../src/engine/scenario'
import { canStartRun, startRun, isSessionOver, endSession, runSession } from '../src/engine/session'
import { advance } from '../src/engine/tick'
import { compileSchema } from '../src/validate/schemaValidator'
import type { GameState } from '../src/engine/types'

const c = loadEngineCatalog()
const fresh = () => loadScenario('slice-oom-kill', c)

describe('canStartRun', () => {
  it('permits the shipped board, which has no unsatisfied ports', () => {
    expect(canStartRun(fresh(), c)).toEqual({ ok: true, unsatisfiedPorts: [] })
  })

  it('refuses a board with an unfilled min-1 port', () => {
    const s = fresh()
    const lonely = { ...s, instances: s.instances.filter((i) => i.def_id === 'cdn') }
    const out = canStartRun(lonely as GameState, c)
    expect(out.ok).toBe(false)
    expect(out.unsatisfiedPorts.map((p) => `${p.instance_id}.${p.port}`)).toContain('cdn-1.origin')
  })
})

describe('startRun', () => {
  it('moves design to run and seeds the rng', () => {
    const out = startRun(fresh(), c)
    expect(out.phase).toBe('run')
    expect(typeof out.rng_seed).toBe('number')
    expect(out.rng_seed).not.toBeNull()
  })

  it('is deterministic — the same scenario seeds the same run', () => {
    // The tautology `startRun(fresh()).rng_seed === startRun(fresh()).rng_seed`
    // passes even if startRun returns a constant. Test the actual properties:
    // (a) different scenario ids give different seeds, and (b) a caller-supplied
    // rng_seed is scrambled rather than passed through raw.
    const seed1 = startRun(fresh(), c).rng_seed
    // A different scenario_id must produce a different seed.
    const seed2 = startRun({ ...fresh(), rng_seed: null, scenario_id: 'different-scenario' } as GameState, c).rng_seed
    expect(seed1).not.toBe(seed2)
    // A caller-supplied seed is scrambled — not passed through raw.
    const withSeed42 = startRun({ ...fresh(), rng_seed: 42 } as GameState, c).rng_seed
    expect(withSeed42).not.toBe(42)
    // The scramble is stable — the same input always gives the same output.
    const withSeed42again = startRun({ ...fresh(), rng_seed: 42 } as GameState, c).rng_seed
    expect(withSeed42).toBe(withSeed42again)
  })

  it('throws when ports are unsatisfied', () => {
    const s = fresh()
    const lonely = { ...s, instances: s.instances.filter((i) => i.def_id === 'cdn') }
    expect(() => startRun(lonely as GameState, c)).toThrow(/port/i)
  })

  it('throws when not in the design phase', () => {
    expect(() => startRun({ ...fresh(), phase: 'run' } as GameState, c)).toThrow(/phase/i)
  })
})

describe('isSessionOver', () => {
  it('is false before the window elapses', () => {
    expect(isSessionOver({ ...startRun(fresh(), c), tick: 10 }, c)).toBe(false)
  })

  it('is true at the window', () => {
    expect(isSessionOver({ ...startRun(fresh(), c), tick: 40 }, c)).toBe(true)
  })

  /** Build a catalogue whose only scenario has `end.kind` set to `kind`.
   *  Spreads the real arrays — same frozen elements, no mutation of the real catalogue. */
  const withEnd = (kind: string) => {
    const real = c.scenarioById.get('slice-oom-kill')!
    return catalogFrom({
      nodes: [...c.nodes],
      layers: [...c.layers],
      tags: [...c.tags],
      actions: [...c.actions],
      metrics: [...c.metrics],
      economy: c.economy,
      incidents: [...c.incidents],
      formats: [...c.formats],
      minigames: [...c.minigames],
      minigameInstances: [...c.minigameInstances],
      levels: [...c.levels],
      scenarios: [{ ...real, id: 'end-kind-probe', end: { kind } }],
    })
  }

  it('endless end kind never ends on its own — returns false', () => {
    const cat = withEnd('endless')
    // endless sessions run until the player calls endSession; isSessionOver always returns false
    expect(
      isSessionOver({ ...startRun(fresh(), c), scenario_id: 'end-kind-probe' }, cat),
    ).toBe(false)
  })

  it('throws a clear not-implemented error for an objectives end kind', () => {
    const cat = withEnd('objectives')
    expect(() =>
      isSessionOver({ ...startRun(fresh(), c), scenario_id: 'end-kind-probe' }, cat),
    ).toThrow(/not implemented/)
  })

  it('throws when the scenario id does not resolve', () => {
    const s = startRun(fresh(), c)
    expect(() => isSessionOver({ ...s, scenario_id: 'no-such' }, c)).toThrow(/unknown id/)
  })
})

describe('endSession', () => {
  it('moves to debrief and marks the session complete', () => {
    const out = endSession(startRun(fresh(), c))
    expect(out.phase).toBe('debrief')
    expect(out.session.status).toBe('complete')
  })

  it('makes advance refuse a terminal state', () => {
    const done = endSession(startRun(fresh(), c))
    expect(() => advance(done, 1, c)).toThrow(/debrief|complete/i)
  })
})

describe('runSession — the golden run', () => {
  it('plays a whole session to its end', () => {
    const out = runSession(startRun(fresh(), c), c)
    expect(out.phase).toBe('debrief')
    expect(out.tick).toBe(40)
  })

  it('is fully reproducible', () => {
    const a = runSession(startRun(fresh(), c), c)
    const b = runSession(startRun(fresh(), c), c)
    expect(a).toEqual(b)
  })

  it('produces a scoreable session', () => {
    const out = runSession(startRun(fresh(), c), c)
    // Exact anchor values measured from the shipped data. If any change, the
    // balance or scenario data changed — this makes that visible rather than silent.
    expect(out.session.peak_p95_ms).toBe(72)
    expect(out.history.uptime_pct!.length).toBe(40)
    expect(out.carried.users).toBeGreaterThan(0)
  })

  it('pins known anchor values for the golden run', () => {
    const out = runSession(startRun(fresh(), c), c)
    // one scripted incident fires
    expect(out.session.incidents_fired).toBe(1)
    // oom_kill never resolves or expires (duration_ticks null, nothing resolves this cycle)
    expect(out.incidents.map((i) => i.incident_id)).toEqual(['oom_kill'])
    expect(out.incidents[0].started_tick).toBe(12)
    // oom_kill damage: health_delta -70 on app-cluster-1 (starts at 100 → 30)
    const app = out.instances.find((i) => i.instance_id === 'app-cluster-1')!
    expect(app.health).toBe(30)
    // reputation decays to 0 while the incident remains active across the full window
    expect(out.carried.reputation).toBe(0)
    // cost_month and profit_month — precisely the values corrupted by the
    // ledger.recurring sign inversion; anchoring them makes a recurrence visible.
    expect(out.history.cost_month?.at(-1)).toBe(115)
    expect(out.history.profit_month?.at(-1)).toBeCloseTo(4885, 0)
  })

  it('leaves the definitions untouched — the two-layer rule holds across a whole run', () => {
    runSession(startRun(fresh(), c), c)
    expect(Object.isFrozen(c.incidentById.get('oom_kill'))).toBe(true)
    expect(c.incidentById.get('oom_kill')!.severity).toBe(3)
  })
})

describe('engine-produced state against state.schema.json', () => {
  // Guard the save format — if the engine ever emits a field that the schema
  // rejects, or omits a required field, this catches it immediately rather than
  // at deserialisation time in a player's browser. Both tests pass today; they
  // are guards, not bug hunts.
  const validate = compileSchema('data/schema/state.schema.json')

  it('validates a completed runSession output', () => {
    const out = runSession(startRun(fresh(), c), c)
    expect(validate(out).errors.join('\n')).toBe('')
  })

  it('validates a mid-run state after several advance calls', () => {
    const mid = advance(startRun(fresh(), c), 15, c)
    expect(validate(mid).errors.join('\n')).toBe('')
  })
})
