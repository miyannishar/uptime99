import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { advance } from '../src/engine/tick'
import {
  resolveText, resolveObject,
  buildNodeContext, buildIncidentContext, buildTicketContext,
  type TemplateContext,
} from '../src/engine/template'

const c = loadEngineCatalog()
const baseState = () => ({
  ...loadScenario('slice-oom-kill', c),
  phase: 'run' as const,
  rng_seed: 42,
})

describe('resolveText', () => {
  it('replaces a known string variable', () => {
    const ctx: TemplateContext = { node_name: 'PostgreSQL' }
    expect(resolveText('{{node_name}} is down', ctx)).toBe('PostgreSQL is down')
  })

  it('replaces a known numeric variable', () => {
    const ctx: TemplateContext = { current_tier: 2 }
    expect(resolveText('tier {{current_tier}}', ctx)).toBe('tier 2')
  })

  it('evaluates {{variable + N}} addition', () => {
    const ctx: TemplateContext = { current_tier: 2 }
    expect(resolveText('upgrade to tier {{current_tier + 1}}', ctx)).toBe('upgrade to tier 3')
  })

  it('evaluates {{variable - N}} subtraction', () => {
    const ctx: TemplateContext = { current_tier: 3 }
    expect(resolveText('was tier {{current_tier - 1}}', ctx)).toBe('was tier 2')
  })

  it('replaces multiple variables in one string', () => {
    const ctx: TemplateContext = { node_name: 'App Cluster', current_tier: 1 }
    expect(resolveText('{{node_name}} on tier {{current_tier}}', ctx))
      .toBe('App Cluster on tier 1')
  })

  it('leaves unknown variables as-is', () => {
    expect(resolveText('{{unknown_var}} here', {})).toBe('{{unknown_var}} here')
  })

  it('returns text unchanged when no templates present', () => {
    expect(resolveText('no templates here', {})).toBe('no templates here')
  })
})

describe('resolveObject', () => {
  it('resolves nested string values', () => {
    const obj = { brief: '{{node_name}} needs help', level: 2 }
    const result = resolveObject(obj, { node_name: 'Redis' })
    expect(result.brief).toBe('Redis needs help')
    expect(result.level).toBe(2)
  })

  it('resolves array string values', () => {
    const obj = { steps: ['restart {{node_name}}', 'check logs'] }
    const result = resolveObject(obj, { node_name: 'CDN' })
    expect((result as any).steps[0]).toBe('restart CDN')
  })

  it('resolves dynamic dial solution value (string "3" from {{current_tier + 1}})', () => {
    const obj = { solution: { value: '{{current_tier + 1}}' } }
    const result = resolveObject(obj, { current_tier: 2 }) as any
    expect(result.solution.value).toBe('3')
  })

  it('does not mutate the input object', () => {
    const obj = { text: '{{node_name}}' }
    const before = JSON.stringify(obj)
    resolveObject(obj, { node_name: 'test' })
    expect(JSON.stringify(obj)).toBe(before)
  })
})

describe('buildNodeContext', () => {
  it('returns node_name and node_id from the catalog', () => {
    const ctx = buildNodeContext(baseState() as any, 'postgres-1', c)
    expect(ctx.node_name).toBe('PostgreSQL')
    expect(ctx.node_id).toBe('postgres')
  })

  it('returns current_tier and target_tier', () => {
    const ctx = buildNodeContext(baseState() as any, 'postgres-1', c)
    expect(ctx.current_tier).toBe(1)
    expect(ctx.target_tier).toBe(2)
  })

  it('returns utilization_pct as a rounded integer', () => {
    const ctx = buildNodeContext(baseState() as any, 'postgres-1', c)
    expect(typeof ctx.utilization_pct).toBe('number')
    expect(Number.isInteger(ctx.utilization_pct)).toBe(true)
  })

  it('returns current_capacity as a formatted string', () => {
    const ctx = buildNodeContext(baseState() as any, 'postgres-1', c)
    // postgres tier 1: capacity 500 qps
    expect(ctx.current_capacity).toBe('500 qps')
  })

  it('returns empty object for unknown instanceId', () => {
    const ctx = buildNodeContext(baseState() as any, 'no-such-id', c)
    expect(Object.keys(ctx).length).toBe(0)
  })
})

describe('buildIncidentContext', () => {
  it('returns incident_name and node_name after oom_kill fires', () => {
    const run = advance(baseState() as any, 13, c)
    const key = run.incidents.find((r: any) => r.incident_id === 'oom_kill')?.key
    expect(key).toBeDefined()
    const ctx = buildIncidentContext(run as any, key!, c)
    expect(ctx.incident_name).toBeDefined()
    expect(ctx.node_name).toBeDefined()
    expect(typeof ctx.node_name).toBe('string')
  })

  it('returns empty object for an unknown incident key', () => {
    const ctx = buildIncidentContext(baseState() as any, 'no-such-key', c)
    expect(Object.keys(ctx).length).toBe(0)
  })
})

describe('buildTicketContext', () => {
  it('returns node_name and tier info for a node_id requirement ticket', () => {
    const state = { ...baseState(), active_tickets: [] }
    const record = {
      ticket_id: 'scale_app_t2',
      started_tick: 1,
      deadline_tick: 25,
      completed: false,
      completion_tick: null,
    }
    const ctx = buildTicketContext(state as any, record as any, c)
    expect(ctx.node_name).toBeDefined()
    expect(ctx.target_tier).toBe(2) // scale_app_t2 requires min_tier 2
  })

  it('returns empty object for an unknown ticket_id', () => {
    const state = { ...baseState(), active_tickets: [] }
    const record = {
      ticket_id: 'no-such-ticket',
      started_tick: 1, deadline_tick: 25, completed: false, completion_tick: null,
    }
    const ctx = buildTicketContext(state as any, record as any, c)
    expect(Object.keys(ctx).length).toBe(0)
  })
})
