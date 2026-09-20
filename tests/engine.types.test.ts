import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { GameState, MetricId, PhaseId, Status } from '../src/engine/types'
import { METRIC_IDS, PHASE_IDS } from '../src/engine/types'

const ENGINE_DIR = resolve(import.meta.dirname, '../src/engine')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('engine public types', () => {
  it('exports the seven metric ids in dependency order', () => {
    expect(METRIC_IDS).toEqual([
      'uptime_pct', 'p95_latency_ms', 'error_rate_pct',
      'reputation', 'users', 'cost_month', 'profit_month',
    ])
  })

  it('exports the three phases', () => {
    expect(PHASE_IDS).toEqual(['design', 'run', 'debrief'])
  })

  it('types a minimal GameState without error', () => {
    const s: GameState = {
      save_version: 1,
      scenario_id: 'x',
      phase: 'design',
      tick: 0,
      budget: 800,
      rng_seed: null,
      carried: { reputation: 100, users: 50000 },
      history: {},
      instances: [],
      incidents: [],
      ledger: [],
      last_fired: {},
      active_tickets: [],
      session: { peak_p95_ms: 0, incidents_fired: 0, incidents_resolved: 0, status: 'running' },
    }
    expect(s.phase satisfies PhaseId).toBe('design')
  })
})

describe('the engine/ui dependency boundary', () => {
  it('has no engine file importing from src/ui', () => {
    // Match /ui/ (subdirectory) and bare /ui at the end of a specifier (alias
    // or directory index form). Without the end-anchor alternative, a specifier
    // like `from '../ui'` or `from '@/ui'` evades the slash-suffix check.
    const offenders = walk(ENGINE_DIR)
      .filter((p) => p.endsWith('.ts'))
      .filter((p) => /from\s+['"][^'"]*\/ui[/'"']/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('regex catches a bare /ui at end of specifier (widened form)', () => {
    expect(/from\s+['"][^'"]*\/ui[/'"']/.test("import x from '../ui'")).toBe(true)
    expect(/from\s+['"][^'"]*\/ui[/'"']/.test('import x from "../ui/adapt"')).toBe(true)
    expect(/from\s+['"][^'"]*\/ui[/'"']/.test("import x from '../utils'")).toBe(false)
  })
})
