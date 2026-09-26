import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/f-terminal.json')

describe('data/minigames/instances/f-terminal.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/f-terminal.json')
  })

  it('holds five instances', () => {
    expect(instances).toHaveLength(5)
  })

  it('covers the shell_fix:2 difficulty-slot', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['shell_fix:2'])
  })

  it('only holds minigames that use the terminal format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('terminal')
  })

  it('every instance has a non-empty prefix and a non-empty history array', () => {
    for (const i of instances) {
      expect(typeof i.given.prefix, i.id).toBe('string')
      expect(i.given.prefix.length, i.id).toBeGreaterThan(0)
      expect(Array.isArray(i.given.history), i.id).toBe(true)
      expect(i.given.history.length, i.id).toBeGreaterThan(0)
    }
  })

  it('every instance has at least one accepts entry and all are non-empty strings', () => {
    for (const i of instances) {
      expect(Array.isArray(i.solution.accepts), i.id).toBe(true)
      expect(i.solution.accepts.length, i.id).toBeGreaterThan(0)
      for (const a of i.solution.accepts) {
        expect(typeof a, `${i.id} accepts entry`).toBe('string')
        expect(a.trim().length, `${i.id} accepts entry`).toBeGreaterThan(0)
      }
    }
  })

  it('history length is at least the history_lines lever value', () => {
    for (const i of instances) {
      expect(i.given.history.length, i.id).toBeGreaterThanOrEqual(i.levers.history_lines)
    }
  })
})
