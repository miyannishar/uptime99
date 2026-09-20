import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { portFills, autoWire, unsatisfiedPorts } from '../src/engine/ports'
import type { NodeInstance } from '../src/engine/types'

const c = loadEngineCatalog()

const inst = (instance_id: string, def_id: string): NodeInstance => ({
  instance_id, def_id, tier: 1, region: 'us-east-1a',
  health: 100, utilization_pct: 0, down: false,
  tags_runtime: [], action_cooldowns: {}, edges_out: [],
  provisioning_until_tick: null, created_tick: 0,
})

const board = [
  inst('cdn-1', 'cdn'), inst('lb-1', 'load_balancer'),
  inst('app-1', 'app_cluster'), inst('pg-1', 'postgres'),
]

describe('autoWire', () => {
  it('wires each consumer to the instances that satisfy its ports', () => {
    const wired = autoWire(board, c)
    const by = Object.fromEntries(wired.map((i) => [i.instance_id, i]))
    // load_balancer requires upstream accepting app_backend -> app_cluster
    expect(by['lb-1'].edges_out).toContain('app-1')
    // app_cluster's datastore port accepts sql_query -> postgres
    expect(by['app-1'].edges_out).toContain('pg-1')
    // postgres requires nothing
    expect(by['pg-1'].edges_out).toEqual([])
  })

  it('never wires a node to itself', () => {
    for (const i of autoWire(board, c)) {
      expect(i.edges_out).not.toContain(i.instance_id)
    }
  })

  it('respects a port max', () => {
    const many = [inst('app-1', 'app_cluster'),
                  inst('pg-1', 'postgres'), inst('pg-2', 'postgres'),
                  inst('pg-3', 'postgres'), inst('pg-4', 'postgres'),
                  inst('pg-5', 'postgres')]
    const wired = autoWire(many, c)
    const app = wired.find((i) => i.instance_id === 'app-1')!
    // datastore port is max 4
    expect(app.edges_out.filter((e) => e.startsWith('pg-')).length).toBe(4)
  })

  it('is deterministic — same input, same wiring', () => {
    expect(autoWire(board, c)).toEqual(autoWire(board, c))
  })
})

describe('portFills', () => {
  it('reports a satisfied port', () => {
    const wired = autoWire(board, c)
    const fills = portFills(wired, 'lb-1', c)
    const upstream = fills.find((f) => f.port === 'upstream')!
    expect(upstream.satisfied).toBe(true)
    expect(upstream.filled).toEqual(['app-1'])
    expect(upstream.min).toBe(1)
  })

  it('reports an unsatisfied min-1 port', () => {
    const lonely = autoWire([inst('cdn-1', 'cdn')], c)
    const origin = portFills(lonely, 'cdn-1', c).find((f) => f.port === 'origin')!
    expect(origin.satisfied).toBe(false)
    expect(origin.filled).toEqual([])
  })

  it('treats a min-0 port with nothing wired as satisfied', () => {
    const alone = autoWire([inst('app-1', 'app_cluster')], c)
    const cache = portFills(alone, 'app-1', c).find((f) => f.port === 'cache')!
    expect(cache.min).toBe(0)
    expect(cache.satisfied).toBe(true)
  })
})

describe('unsatisfiedPorts', () => {
  it('is empty for the shipped slice board', () => {
    expect(unsatisfiedPorts(autoWire(board, c), c)).toEqual([])
  })

  it('names the CDN origin port when no origin exists', () => {
    const bad = unsatisfiedPorts(autoWire([inst('cdn-1', 'cdn')], c), c)
    expect(bad.map((b) => `${b.instance_id}.${b.port.port}`)).toEqual(['cdn-1.origin'])
  })
})

describe('portFills — overfilled port', () => {
  it('reports unsatisfied when filled count exceeds max', () => {
    // autoWire caps at max, so an overfilled state can only be constructed by
    // hand. The app_cluster datastore port has max:4; 5 postgres edges exceed it.
    // This pins the behaviour checkPortAcceptsDisjoint exists to prevent.
    const pg5 = [1, 2, 3, 4, 5].map((n) => inst(`pg-${n}`, 'postgres'))
    const app: NodeInstance = {
      ...inst('app-1', 'app_cluster'),
      edges_out: pg5.map((i) => i.instance_id),
    }
    const instances = [app, ...pg5]
    const fills = portFills(instances, 'app-1', c)
    const datastore = fills.find((f) => f.port === 'datastore')!
    expect(datastore.filled).toHaveLength(5)
    expect(datastore.max).toBe(4)
    expect(datastore.satisfied).toBe(false)
  })
})
