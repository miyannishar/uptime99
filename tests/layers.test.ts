import { describe, it, expect } from 'vitest'
import { expectValidAgainst } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

type Layer = { id: string; layer_index: number | null; on_request_path: boolean }

const { layers } = loadJson<{ layers: Layer[] }>('data/layers.json')

describe('data/layers.json', () => {
  it('validates against the layer schema', () => {
    expectValidAgainst('data/schema/layer.schema.json', 'data/layers.json')
  })

  it('defines exactly 7 layers', () => {
    expect(layers).toHaveLength(7)
  })

  it('gives on-path layers a contiguous index from 1', () => {
    const indices = layers
      .filter((l) => l.on_request_path)
      .map((l) => l.layer_index)
      .sort((a, b) => (a as number) - (b as number))
    expect(indices).toEqual([1, 2, 3, 4])
  })

  it('gives off-path layers a null index', () => {
    const offPath = layers.filter((l) => !l.on_request_path)
    expect(offPath.map((l) => l.layer_index)).toEqual([null, null, null])
  })

  it('orders the request path edge to data', () => {
    const onPath = layers
      .filter((l) => l.on_request_path)
      .sort((a, b) => (a.layer_index as number) - (b.layer_index as number))
    expect(onPath.map((l) => l.id)).toEqual(['edge', 'ingress', 'compute', 'data'])
  })
})
