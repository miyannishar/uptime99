import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/g-log-hunt.json')

describe('data/minigames/instances/g-log-hunt.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/g-log-hunt.json')
  })

  it('holds three instances', () => {
    expect(instances).toHaveLength(3)
  })

  it('covers the log_hunt_rca:2 difficulty-slot', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['log_hunt_rca:2'])
  })

  it('only holds minigames that use the log_hunt format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('log_hunt')
  })

  it('every instance has a non-empty source and a non-empty lines array', () => {
    for (const i of instances) {
      expect(typeof i.given.source, i.id).toBe('string')
      expect(i.given.source.length, i.id).toBeGreaterThan(0)
      expect(Array.isArray(i.given.lines), i.id).toBe(true)
      expect(i.given.lines.length, i.id).toBeGreaterThan(0)
    }
  })

  it('every line has non-empty ts, level, and text fields', () => {
    for (const i of instances) {
      for (const [idx, line] of i.given.lines.entries()) {
        const ctx = `${i.id} line ${idx + 1}`
        expect(typeof line.ts, ctx).toBe('string')
        expect(line.ts.length, ctx).toBeGreaterThan(0)
        expect(typeof line.level, ctx).toBe('string')
        expect(line.level.length, ctx).toBeGreaterThan(0)
        expect(typeof line.text, ctx).toBe('string')
        expect(line.text.length, ctx).toBeGreaterThan(0)
      }
    }
  })

  it('solution.line is in range (1-based, within lines array)', () => {
    for (const i of instances) {
      expect(i.solution.line, i.id).toBeGreaterThanOrEqual(1)
      expect(i.solution.line, i.id).toBeLessThanOrEqual(i.given.lines.length)
    }
  })

  it('the solution line has level ERROR or FATAL', () => {
    for (const i of instances) {
      const answerLine = i.given.lines[i.solution.line - 1]
      const level = answerLine.level.toUpperCase()
      expect(['ERROR', 'FATAL'], `${i.id}: expected ERROR or FATAL but got ${level}`).toContain(level)
    }
  })

  it('lines.length is at least levers.line_count', () => {
    for (const i of instances) {
      expect(i.given.lines.length, i.id).toBeGreaterThanOrEqual(i.levers.line_count)
    }
  })

  it('count of ERROR/FATAL lines other than the answer is >= levers.decoy_errors', () => {
    for (const i of instances) {
      const decoys = i.given.lines.filter(
        (l: any, idx: number) =>
          (l.level.toUpperCase() === 'ERROR' || l.level.toUpperCase() === 'FATAL') &&
          idx + 1 !== i.solution.line,
      )
      expect(decoys.length, `${i.id}: expected >= ${i.levers.decoy_errors} decoy ERROR/FATAL lines`).toBeGreaterThanOrEqual(i.levers.decoy_errors)
    }
  })
})

describe('log_hunt answer uniqueness', () => {
  it('no earlier line repeats the answer text unless it is also accepted', () => {
    for (const i of instances) {
      const answer = i.given.lines[i.solution.line - 1].text
      const accepted = new Set([i.solution.line, ...(i.solution.accept ?? [])])
      i.given.lines.forEach((l: any, k: number) => {
        if (k + 1 < i.solution.line && l.text === answer) {
          expect(accepted.has(k + 1), `${i.id}: line ${k + 1} repeats the answer text`).toBe(true)
        }
      })
    }
  })
  it('every accepted line is in range and ERROR/FATAL', () => {
    for (const i of instances) {
      for (const n of i.solution.accept ?? []) {
        expect(['ERROR', 'FATAL'], `${i.id}:${n}`).toContain(i.given.lines[n - 1].level)
      }
    }
  })
})
