import { describe, it, expect } from 'vitest'
import { expectValidAgainst } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { minigames } = loadJson<any>('data/minigames/registry.json')
const { formats } = loadJson<any>('data/minigames/formats.json')
const actions = loadJson<any>('data/actions.json').actions
const byId = Object.fromEntries(minigames.map((m: any) => [m.id, m]))

describe('data/minigames/registry.json', () => {
  it('validates against the registry schema', () => {
    expectValidAgainst('data/schema/minigame-registry.schema.json', 'data/minigames/registry.json')
  })

  it('defines exactly the 15 minigames the actions reference', () => {
    const fromActions = [...new Set(actions.map((a: any) => a.minigame))].sort()
    expect(minigames.map((m: any) => m.id).sort()).toEqual(fromActions)
    expect(minigames).toHaveLength(15)
  })

  it('gives every minigame a format that exists', () => {
    const ids = new Set(formats.map((f: any) => f.id))
    for (const m of minigames) expect(ids.has(m.format), m.id).toBe(true)
  })

  it('maps the workhorse minigames to the formats the spec assigns', () => {
    expect(byId.threshold_tuning.format).toBe('dial')
    expect(byId.restore_drill.format).toBe('ordered_sequence')
    expect(byId.yaml_manifest.format).toBe('fill_blank')
    expect(byId.topology_puzzle.format).toBe('wiring')
    expect(byId.query_plan_puzzle.format).toBe('evidence')
  })

  it('uses all five formats at least once', () => {
    expect(new Set(minigames.map((m: any) => m.format)).size).toBe(5)
  })

  it('distributes the minigames across formats as the spec specifies', () => {
    const count: Record<string, number> = {}
    for (const m of minigames) count[m.format] = (count[m.format] ?? 0) + 1
    expect(count).toEqual({
      ordered_sequence: 3, fill_blank: 4, dial: 4, wiring: 1, evidence: 3,
    })
  })
})
