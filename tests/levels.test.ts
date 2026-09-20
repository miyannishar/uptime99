import { describe, it, expect } from 'vitest'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'
import {
  loadLevels, checkLevelShape, checkLevelIncidentCoverage, checkScenarioLevelRefs,
} from '../src/validate/levelChecks'
import { loadScenarios } from '../src/validate/scenarioChecks'
import { loadIncidents } from '../src/validate/incidentChecks'

const validate = compileSchema('data/schema/level.schema.json')
const base = loadJson<any>('data/levels.json')
const clone = () => structuredClone(base)
const levels = loadLevels()
const incidents = loadIncidents()

describe('level.schema.json', () => {
  it('accepts the shipped file', () => {
    expect(validate(base).errors.join('\n')).toBe('')
  })

  it('rejects a severity_max outside 1..5', () => {
    const bad = clone()
    bad.levels[0].severity_max = 6
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a non-positive arrival_mean_ticks', () => {
    const bad = clone()
    bad.levels[0].arrival_mean_ticks = 0
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a non-positive max_concurrent', () => {
    const bad = clone()
    bad.levels[0].max_concurrent = 0
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown field', () => {
    const bad = clone()
    bad.levels[0].severity_min = 1
    expect(validate(bad).valid).toBe(false)
  })
})

describe('checkLevelShape', () => {
  it('passes on the shipped levels', () => {
    expect(checkLevelShape(levels)).toEqual([])
  })

  it('fires when levels are not contiguous from 1', () => {
    const bad = structuredClone(levels).filter((l: any) => l.level !== 2)
    expect(checkLevelShape(bad).join()).toMatch(/contiguous|gap/i)
  })

  it('fires on a duplicate level number', () => {
    const bad = [...structuredClone(levels), structuredClone(levels[0])]
    expect(checkLevelShape(bad).join()).toMatch(/duplicate/i)
  })

  it('fires when difficulty does not increase monotonically', () => {
    const bad = structuredClone(levels)
    bad[1].arrival_mean_ticks = bad[0].arrival_mean_ticks + 10
    expect(checkLevelShape(bad).join()).toMatch(/arrival_mean_ticks/)
  })
})

describe('checkLevelIncidentCoverage', () => {
  it('passes on the shipped data — every level has an eligible incident', () => {
    expect(checkLevelIncidentCoverage(levels, incidents)).toEqual([])
  })

  it('fires when a level admits no incident at all', () => {
    const bad = structuredClone(levels)
    bad[0].severity_max = 0
    expect(checkLevelIncidentCoverage(bad, incidents).join()).toMatch(/no incident/i)
  })

  it('reports how many incidents each level admits, so a thin level is visible', () => {
    const thin = structuredClone(levels)
    thin[0].severity_max = 1
    const out = checkLevelIncidentCoverage(thin, incidents)
    // severity_max 1 admits only 5 of 49 — legal but worth surfacing
    expect(out.join()).toMatch(/5 incident/)
  })
})

describe('checkScenarioLevelRefs', () => {
  it('passes on the shipped scenarios', () => {
    expect(checkScenarioLevelRefs(loadScenarios(), levels)).toEqual([])
  })

  it('fires when a scenario names a level that does not exist', () => {
    const bad = structuredClone(loadScenarios())
    bad[0].level = 99
    expect(checkScenarioLevelRefs(bad, levels).join()).toMatch(/99/)
  })

  it('fires when a level:null scenario carries no difficulty block', () => {
    const bad = structuredClone(loadScenarios())
    bad[0].level = null
    delete bad[0].difficulty
    expect(checkScenarioLevelRefs(bad, levels).join()).toMatch(/difficulty/)
  })
})
