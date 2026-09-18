import { describe, it, expect } from 'vitest'
import { expectValidNodeFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { nodes } = loadJson<any>('data/nodes/ingress.json')

describe('data/nodes/ingress.json', () => {
  it('is a valid node file', () => {
    expectValidNodeFile('data/nodes/ingress.json')
  })

  it('defines the two ingress nodes', () => {
    expect(nodes.map((n: any) => n.id).sort()).toEqual(['api_gateway', 'load_balancer'])
  })

  it('has the load balancer require an app backend', () => {
    const lb = nodes.find((n: any) => n.id === 'load_balancer')
    expect(lb.provides).toContain('origin')
    expect(lb.requires[0].accepts).toContain('app_backend')
    expect(lb.requires[0].min).toBe(1)
  })
})
