import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'
import {
  loadScenarios, checkScenarioRefs, checkScenarioBoards, checkScenarioProgression,
} from '../src/validate/scenarioChecks'
import { loadCatalog } from '../src/validate/integrity'

const validate = compileSchema('data/schema/scenario.schema.json')
const base = loadJson<any>('data/scenarios/slice-oom-kill.json')
const clone = () => structuredClone(base)
const catalog = loadCatalog()
const scenarios = loadScenarios()

describe('scenario.schema.json', () => {
  it('accepts the shipped scenario', () => {
    expect(validate(base).errors.join('\n')).toBe('')
  })

  it('rejects an unknown end kind', () => {
    const bad = clone()
    bad.end = { kind: 'survive_forever' }
    expect(validate(bad).valid).toBe(false)
  })

  it('requires ticks on a fixed_window end', () => {
    const bad = clone()
    bad.end = { kind: 'fixed_window' }
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a board entry without coordinates', () => {
    const bad = clone()
    delete bad.board[0].x
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts a null level for a scenario outside the campaign', () => {
    const s = clone()
    s.level = null
    expect(validate(s).errors.join('\n')).toBe('')
  })

  it('rejects an unknown incident_source', () => {
    const bad = clone()
    bad.incident_source = 'vibes'
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts a free-play shape: endless, weighted, no authored incidents', () => {
    const free = clone()
    free.id = 'free-play-sandbox'
    free.level = null
    free.unlocked_by = []
    free.incident_source = 'weighted'
    free.end = { kind: 'endless' }
    free.incidents = []
    expect(validate(free).errors.join('\n')).toBe('')
  })

  it('accepts unlocked_by naming prerequisite scenarios', () => {
    const s = clone()
    s.unlocked_by = ['slice-oom-kill']
    expect(validate(s).errors.join('\n')).toBe('')
  })

  it('rejects at_tick: 0 — fires before the first tick', () => {
    const bad = clone()
    bad.incidents[0].at_tick = 0
    expect(validate(bad).valid).toBe(false)
  })

  it('accepts at_tick: 1 — fires on the first tick', () => {
    const s = clone()
    s.incidents[0].at_tick = 1
    expect(validate(s).errors.join('\n')).toBe('')
  })

  it('requires the three mode fields', () => {
    for (const key of ['level', 'unlocked_by', 'incident_source']) {
      const bad = clone()
      delete bad[key]
      expect(validate(bad).valid, `missing ${key} should fail`).toBe(false)
    }
  })
})

describe('the shipped scenarios', () => {
  const slice = scenarios.find((s: any) => s.id === 'slice-oom-kill')!

  it('loads 6 scenarios (5 levels + free play)', () => {
    expect(scenarios).toHaveLength(6)
    expect(scenarios.map((s: any) => s.id).sort()).toEqual([
      'free-play', 'level-2-cache-miss', 'level-3-reliability',
      'level-4-queue-depth', 'level-5-production', 'slice-oom-kill',
    ])
  })

  it('puts one node on each on-path layer on the slice board', () => {
    const layers = slice.board.map(
      (b: any) => catalog.nodes.find((n: any) => n.id === b.def_id)!.layer,
    )
    expect([...layers].sort()).toEqual(['compute', 'data', 'edge', 'ingress'])
  })

  it('passes reference integrity', () => {
    expect(checkScenarioRefs(scenarios, catalog)).toEqual([])
  })

  it('passes board integrity', () => {
    expect(checkScenarioBoards(scenarios, catalog)).toEqual([])
  })

  it('fires an incident that can actually target the slice board', () => {
    expect(slice.incidents.map((i: any) => i.incident_id)).toEqual(['oom_kill'])
  })

  it('slice is level 1 of the campaign, unlocked from the start, with a scripted schedule', () => {
    expect(slice.level).toBe(1)
    expect(slice.unlocked_by).toEqual([])
    expect(slice.incident_source).toBe('scripted')
  })

  it('free-play has no time limit and a difficulty block', () => {
    const fp = scenarios.find((s: any) => s.id === 'free-play')!
    expect(fp.end.kind).toBe('endless')
    expect(fp.level).toBeNull()
    expect(fp.difficulty).toBeDefined()
  })
})

describe('checkScenarioProgression', () => {
  it('passes on the shipped set', () => {
    expect(checkScenarioProgression(scenarios)).toEqual([])
  })

  it('fires when unlocked_by names a scenario that does not exist', () => {
    const bad = structuredClone(scenarios)
    bad[0].unlocked_by = ['level-99']
    expect(checkScenarioProgression(bad).join()).toMatch(/level-99/)
  })

  it('fires when a scenario unlocks itself', () => {
    const bad = structuredClone(scenarios)
    const idx = bad.findIndex((s: any) => s.id === 'free-play')
    bad[idx].unlocked_by = ['free-play']
    expect(checkScenarioProgression(bad).join()).toMatch(/itself|cycle/i)
  })

  it('fires when a weighted scenario also authors an incident schedule', () => {
    const bad = structuredClone(scenarios)
    const idx = bad.findIndex((s: any) => s.id === 'slice-oom-kill')
    bad[idx].incident_source = 'weighted'
    expect(checkScenarioProgression(bad).join()).toMatch(/weighted/)
  })

  it('fires when a scripted scenario authors no incidents at all', () => {
    const bad = structuredClone(scenarios)
    const idx = bad.findIndex((s: any) => s.id === 'slice-oom-kill')
    bad[idx].incidents = []
    expect(checkScenarioProgression(bad).join()).toMatch(/scripted/)
  })
})

describe('checkScenarioRefs', () => {
  it('fires on an unknown def_id', () => {
    const bad = structuredClone(scenarios)
    bad[0].board[0].def_id = 'quantum_cache'
    expect(checkScenarioRefs(bad, catalog).join()).toMatch(/quantum_cache/)
  })

  it('fires on an unknown incident_id', () => {
    const bad = structuredClone(scenarios)
    const idx = bad.findIndex((s: any) => s.id === 'slice-oom-kill')
    bad[idx].incidents[0].incident_id = 'gremlins'
    expect(checkScenarioRefs(bad, catalog).join()).toMatch(/gremlins/)
  })

  it('accepts at_tick equal to end.ticks — fires on the last tick', () => {
    const s = structuredClone(scenarios)
    const idx = s.findIndex((x: any) => x.id === 'slice-oom-kill')
    s[idx].incidents[0].at_tick = s[idx].end.ticks  // 40
    expect(checkScenarioRefs(s, catalog)).toEqual([])
  })

  it('fires when at_tick exceeds end.ticks — fires after the window', () => {
    const s = structuredClone(scenarios)
    const idx = s.findIndex((x: any) => x.id === 'slice-oom-kill')
    s[idx].incidents[0].at_tick = s[idx].end.ticks + 1
    expect(checkScenarioRefs(s, catalog).join()).toMatch(/after|never appear/i)
  })

  it('fires on a layer not in allowed_layers', () => {
    const bad = structuredClone(scenarios)
    bad[0].allowed_layers = ['edge']
    expect(checkScenarioBoards(bad, catalog).join()).toMatch(/compute|ingress|data/)
  })
})

describe('checkScenarioBoards', () => {
  it('fires when a tier does not exist on the node', () => {
    const bad = structuredClone(scenarios)
    bad[0].board[0].tier = 9
    expect(checkScenarioBoards(bad, catalog).join()).toMatch(/tier 9/)
  })

  it('fires when the starting board exceeds the budget', () => {
    const bad = structuredClone(scenarios)
    bad[0].starting_budget = 10
    expect(checkScenarioBoards(bad, catalog).join()).toMatch(/unsustainable/)
  })
})
