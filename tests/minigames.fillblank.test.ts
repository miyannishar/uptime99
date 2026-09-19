import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/b-fill-blank.json')

describe('data/minigames/instances/b-fill-blank.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/b-fill-blank.json')
  })

  it('holds eight instances', () => {
    expect(instances).toHaveLength(8)
  })

  it('covers all seven fill-blank difficulty-slots', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual([
      'cache_key_match:2', 'iam_policy_puzzle:3', 'iam_policy_puzzle:4',
      'incident_comms:1', 'incident_comms:2', 'yaml_manifest:2', 'yaml_manifest:5',
    ])
  })

  it('only holds minigames that use the fill_blank format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('fill_blank')
  })

  it('has a solution blank for every marker in the template', () => {
    for (const i of instances) {
      const markers = [...i.given.template.matchAll(/\{\{(\d+)\}\}/g)].map((m: any) => m[1])
      expect(markers.length, i.id).toBe(i.levers.blank_count)
      expect(Object.keys(i.solution.blanks).sort(), i.id).toEqual([...markers].sort())
    }
  })

  it('supplies options exactly when input_mode is pick_from_list', () => {
    for (const i of instances) {
      if (i.levers.input_mode === 'pick_from_list') {
        expect(i.given.options, i.id).toBeTruthy()
        for (const [k, v] of Object.entries<any>(i.given.options)) {
          expect(v, `${i.id} blank ${k}`).toContain(i.solution.blanks[k])
        }
      } else {
        expect(i.given.options, i.id).toBeUndefined()
      }
    }
  })
})
