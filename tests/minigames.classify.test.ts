import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/j-classify.json')

describe('data/minigames/instances/j-classify.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/j-classify.json')
  })

  it('holds three instances', () => {
    expect(instances).toHaveLength(3)
  })

  it('covers the signal_sort:2 difficulty-slot', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['signal_sort:2'])
  })

  it('only holds minigames that use the classify format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('classify')
  })

  it('items.length === levers.item_count for every instance', () => {
    for (const i of instances) {
      expect(i.given.items.length, `${i.id}: items.length`).toBe(i.levers.item_count)
    }
  })

  it('bins.length === levers.bin_count for every instance', () => {
    for (const i of instances) {
      expect(i.given.bins.length, `${i.id}: bins.length`).toBe(i.levers.bin_count)
    }
  })

  it('every item id has a solution bin', () => {
    for (const i of instances) {
      for (const item of i.given.items) {
        expect(i.solution.bins, `${i.id}: item ${item.id} missing from solution.bins`).toHaveProperty(item.id)
      }
    }
  })

  it('every solution bin id is a given.bins id', () => {
    for (const i of instances) {
      const binIds = new Set(i.given.bins.map((b: any) => b.id))
      for (const [itemId, binId] of Object.entries(i.solution.bins as Record<string, string>)) {
        expect(binIds, `${i.id}: solution bin '${binId}' for item '${itemId}' is not in given.bins`).toContain(binId)
      }
    }
  })

  it('every bin receives at least one item', () => {
    for (const i of instances) {
      const binIds = i.given.bins.map((b: any) => b.id)
      const used = new Set(Object.values(i.solution.bins as Record<string, string>))
      for (const binId of binIds) {
        expect(used, `${i.id}: bin '${binId}' receives no items`).toContain(binId)
      }
    }
  })
})
