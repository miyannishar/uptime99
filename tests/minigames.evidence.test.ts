import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/e-evidence.json')

describe('data/minigames/instances/e-evidence.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/e-evidence.json')
  })

  it('holds five instances', () => {
    expect(instances).toHaveLength(5)
  })

  it('covers all three evidence difficulty-slots', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['diff_review:3', 'log_triage:1', 'query_plan_puzzle:3'])
  })

  it('only holds minigames that use the evidence format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('evidence')
  })

  it('requires distractors, since choosing is the interaction', () => {
    for (const i of instances) {
      expect(i.distractors, i.id).toBeTruthy()
      expect(i.distractors.length, i.id).toBe(i.levers.distractor_count)
    }
  })

  it('shows at least as many output lines as the lever claims', () => {
    for (const i of instances) {
      expect(i.given.output.split('\n').length, i.id).toBeGreaterThanOrEqual(i.levers.output_lines)
    }
  })

  it('uses a known evidence kind', () => {
    for (const i of instances) {
      expect(['log', 'explain', 'deploy_history'], i.id).toContain(i.given.kind)
    }
  })
})
