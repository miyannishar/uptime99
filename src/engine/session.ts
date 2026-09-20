import { unsatisfiedPorts } from './ports'
import { scenarioById } from './scenario'
import { seedFrom, rngFrom } from './rng'
import { advance } from './tick'
import { createLogger } from './logger'
import type { EngineCatalog } from './catalogFrom'
import type { GameState } from './types'

const log = createLogger('session')

export function canStartRun(
  state: GameState, catalog: EngineCatalog,
): { ok: boolean; unsatisfiedPorts: { instance_id: string; port: string }[] } {
  const bad = unsatisfiedPorts(state.instances, catalog)
    .map((u) => ({ instance_id: u.instance_id, port: u.port.port }))
  if (bad.length > 0) {
    log.warn('unsatisfied ports', { count: bad.length, ports: bad })
  }
  return { ok: bad.length === 0, unsatisfiedPorts: bad }
}

/** design -> run. Refuses an incomplete board; seeds the rng from the scenario. */
export function startRun(state: GameState, catalog: EngineCatalog): GameState {
  if (state.phase !== 'design') {
    throw new Error(`session: startRun requires the design phase, got '${state.phase}'`)
  }
  log.info('startRun', { scenario: state.scenario_id, nodeCount: state.instances.length })
  const gate = canStartRun(state, catalog)
  if (!gate.ok) {
    throw new Error(
      `session: cannot start the run — unsatisfied port(s): ` +
      gate.unsatisfiedPorts.map((p) => `${p.instance_id}.${p.port}`).join(', '),
    )
  }
  // Scramble the seed through rngFrom before the first draw. A raw small integer
  // seed is pathological for xorshift32 (seeds 1..399 all force an arrival on
  // tick 1 at level 1 due to the first draw being ~seed * 6.3e-5). `advance`
  // treats rng_seed as an already-scrambled stream position — re-scrambling there
  // would break the "12 single ticks == dt=12" equivalence asserted in
  // tests/engine.tick.test.ts. `startRun` is the single authoritative boundary
  // where an author- or player-supplied seed enters the system.
  const newState: GameState = { ...state, phase: 'run', rng_seed: rngFrom(state.rng_seed ?? seedFrom(state.scenario_id)).seed }
  log.debug('startRun complete', { phase: newState.phase, rngSeed: newState.rng_seed })
  return newState
}

export function isSessionOver(state: GameState, catalog: EngineCatalog): boolean {
  const end = scenarioById(state.scenario_id, catalog).end
  switch (end.kind) {
    case 'fixed_window': {
      const over = state.tick >= end.ticks
      if (over) log.info('session window closed', { tick: state.tick, windowTicks: end.ticks })
      return over
    }
    case 'endless':
      return false  // never ends on its own; player quits via endSession
    case 'objectives':
      throw new Error(
        `session: end.kind '${end.kind}' is declared but not implemented — ` +
        `a session that cannot end would look like a hang`,
      )
    default:
      throw new Error(`session: unknown end.kind '${(end as { kind: string }).kind}'`)
  }
}

/** run -> debrief. Terminal: advance refuses a debrief state. */
export function endSession(state: GameState): GameState {
  log.info('endSession', { finalTick: state.tick, finalReputation: state.carried.reputation.toFixed(0), finalUsers: state.carried.users })
  return {
    ...state,
    phase: 'debrief',
    session: { ...state.session, status: 'complete' },
  }
}

/** Play a run to its end condition, one tick at a time. */
export function runSession(state: GameState, catalog: EngineCatalog): GameState {
  if (state.phase !== 'run') {
    throw new Error(`session: runSession requires the run phase, got '${state.phase}'`)
  }
  log.info('runSession start', { scenario: state.scenario_id, startTick: state.tick })
  let s = state
  while (!isSessionOver(s, catalog)) s = advance(s, 1, catalog)
  log.info('runSession end', { endTick: s.tick })
  return endSession(s)
}
