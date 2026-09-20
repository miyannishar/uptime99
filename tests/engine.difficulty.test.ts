import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { difficultyFor } from '../src/engine/difficulty'
import { scenarioById } from '../src/engine/scenario'

const c = loadEngineCatalog()

describe('the catalogue carries levels', () => {
  it('loads all five levels', () => {
    expect(c.levels).toHaveLength(5)
  })

  it('freezes them, like every other definition family', () => {
    expect(Object.isFrozen(c.levels[0])).toBe(true)
    expect(() => { (c.levels[0] as any).severity_max = 5 }).toThrow()
  })

  it('shares level object references between the array and the Map', () => {
    for (const l of c.levels) {
      expect(c.levelByNumber.get(l.level)).toBe(l)
    }
  })

  it('freezes Map values — mutation through the Map throws', () => {
    expect(() => { (c.levelByNumber.get(1) as any).arrival_mean_ticks = 1 }).toThrow()
  })
})

describe('difficultyFor', () => {
  it('resolves a levelled scenario to its level row', () => {
    const s = scenarioById('slice-oom-kill', c)
    const d = difficultyFor(s, c)
    const row = c.levels.find((l: any) => l.level === 1)!
    expect(d).toEqual({
      arrival_mean_ticks: row.arrival_mean_ticks,
      severity_max: row.severity_max,
      max_concurrent: row.max_concurrent,
    })
  })

  it('uses a level:null scenario\'s own difficulty block', () => {
    const free = {
      ...scenarioById('slice-oom-kill', c),
      level: null,
      difficulty: { arrival_mean_ticks: 9, severity_max: 5, max_concurrent: 4 },
    }
    expect(difficultyFor(free as any, c)).toEqual({
      arrival_mean_ticks: 9, severity_max: 5, max_concurrent: 4,
    })
  })

  it('throws when a level:null scenario has no difficulty block', () => {
    const broken = { ...scenarioById('slice-oom-kill', c), level: null, difficulty: undefined }
    expect(() => difficultyFor(broken as any, c)).toThrow(/difficulty/)
  })

  it('throws when a scenario names a level that does not exist', () => {
    const broken = { ...scenarioById('slice-oom-kill', c), level: 99 }
    expect(() => difficultyFor(broken as any, c)).toThrow(/99/)
  })

  it('prefers an explicit difficulty block over the level row', () => {
    const s = {
      ...scenarioById('slice-oom-kill', c),
      level: 1,
      difficulty: { arrival_mean_ticks: 3, severity_max: 5, max_concurrent: 9 },
    }
    expect(difficultyFor(s as any, c).arrival_mean_ticks).toBe(3)
  })
})
