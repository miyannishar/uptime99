import { describe, it, expect } from 'vitest'
import { expectValidAgainst } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'
import { slotsFor } from '../src/engine/minigamePick'

const { minigames } = loadJson<any>('data/minigames/registry.json')
const { formats } = loadJson<any>('data/minigames/formats.json')
const actions = loadJson<any>('data/actions.json').actions
const byId = Object.fromEntries(minigames.map((m: any) => [m.id, m]))

describe('data/minigames/registry.json', () => {
  it('validates against the registry schema', () => {
    expectValidAgainst('data/schema/minigame-registry.schema.json', 'data/minigames/registry.json')
  })

  it('defines exactly the 23 minigames the actions reference', () => {
    const fromActions = [...new Set(actions.flatMap((a: any) => slotsFor(a).map((s: any) => s.minigame)))].sort()
    expect(minigames.map((m: any) => m.id).sort()).toEqual(fromActions)
    expect(minigames).toHaveLength(23)
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

  it('uses all ten formats at least once', () => {
    expect(new Set(minigames.map((m: any) => m.format)).size).toBe(10)
  })

  it('distributes the minigames across formats as the spec specifies', () => {
    const count: Record<string, number> = {}
    for (const m of minigames) count[m.format] = (count[m.format] ?? 0) + 1
    expect(count).toEqual({
      ordered_sequence: 4, fill_blank: 6, dial: 4, wiring: 1, evidence: 3, terminal: 1, log_hunt: 1, patch: 1, monitor: 1, classify: 1,
    })
  })
})
