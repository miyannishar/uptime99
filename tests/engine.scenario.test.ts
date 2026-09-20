import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { unsatisfiedPorts } from '../src/engine/ports'
import { deriveMetrics } from '../src/engine/metrics'

const c = loadEngineCatalog()
const validateState = compileSchema('data/schema/state.schema.json')

describe('loadScenario', () => {
  const s = loadScenario('slice-oom-kill', c)

  it('starts in the design phase at tick zero', () => {
    expect(s.phase).toBe('design')
    expect(s.tick).toBe(0)
  })

  it('takes the budget from the scenario', () => {
    expect(s.budget).toBe(800)
  })

  it('creates one instance per board entry with deterministic ids', () => {
    expect(s.instances.map((i) => i.instance_id))
      .toEqual(['cdn-1', 'load-balancer-1', 'app-cluster-1', 'postgres-1'])
  })

  it('starts every instance healthy, up and idle', () => {
    for (const i of s.instances) {
      expect(i.health).toBe(100)
      expect(i.down).toBe(false)
      expect(i.utilization_pct).toBe(0)
      expect(i.tags_runtime).toEqual([])
      expect(i.provisioning_until_tick).toBeNull()
    }
  })

  it('auto-wires the board', () => {
    const app = s.instances.find((i) => i.instance_id === 'app-cluster-1')!
    expect(app.edges_out).toContain('postgres-1')
  })

  it('produces a board with no unsatisfied ports', () => {
    expect(unsatisfiedPorts(s.instances, c)).toEqual([])
  })

  it('produces a state that validates against the schema', () => {
    expect(validateState(s).errors.join('\n')).toBe('')
  })

  it('is measurable immediately', () => {
    const m = deriveMetrics(s, c)
    expect(m.uptime_pct).toBe(100)
    expect(m.p95_latency_ms).toBeCloseTo(72, 1)
    expect(m.cost_month).toBeCloseTo(115, 1)
  })

  it('is deterministic', () => {
    expect(loadScenario('slice-oom-kill', c)).toEqual(loadScenario('slice-oom-kill', c))
  })

  it('throws on an unknown scenario id', () => {
    expect(() => loadScenario('no-such-scenario', c)).toThrow(/no-such-scenario/)
  })
})
