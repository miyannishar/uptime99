import { describe, it, expect } from 'vitest'
import { expectValidInstanceFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { instances } = loadJson<any>('data/minigames/instances/h-patch.json')

describe('data/minigames/instances/h-patch.json', () => {
  it('is a valid instance file', () => {
    expectValidInstanceFile('data/minigames/instances/h-patch.json')
  })

  it('holds three instances', () => {
    expect(instances).toHaveLength(3)
  })

  it('covers the config_patch:3 difficulty-slot', () => {
    const slots = [...new Set(instances.map((i: any) => `${i.minigame}:${i.difficulty}`))].sort()
    expect(slots).toEqual(['config_patch:3'])
  })

  it('only holds minigames that use the patch format', () => {
    const { minigames } = loadJson<any>('data/minigames/registry.json')
    const fmt = Object.fromEntries(minigames.map((m: any) => [m.id, m.format]))
    for (const i of instances) expect(fmt[i.minigame], i.id).toBe('patch')
  })

  it('every instance has a non-empty filename, language, and content', () => {
    for (const i of instances) {
      expect(typeof i.given.filename, i.id).toBe('string')
      expect(i.given.filename.length, i.id).toBeGreaterThan(0)
      expect(typeof i.given.language, i.id).toBe('string')
      expect(i.given.language.length, i.id).toBeGreaterThan(0)
      expect(typeof i.given.content, i.id).toBe('string')
      expect(i.given.content.length, i.id).toBeGreaterThan(0)
    }
  })

  it('every instance has a positive integer line number and at least one must_contain string', () => {
    for (const i of instances) {
      expect(Number.isInteger(i.solution.line), i.id).toBe(true)
      expect(i.solution.line, i.id).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(i.solution.must_contain), i.id).toBe(true)
      expect(i.solution.must_contain.length, i.id).toBeGreaterThan(0)
    }
  })

  it('solution.line is within the content line count', () => {
    for (const i of instances) {
      const lineCount = i.given.content.split('\n').length
      expect(i.solution.line, `${i.id}: solution.line ${i.solution.line} > content lines ${lineCount}`).toBeLessThanOrEqual(lineCount)
    }
  })

  it('content line count is at least the file_lines lever value', () => {
    for (const i of instances) {
      const lineCount = i.given.content.split('\n').length
      expect(lineCount, `${i.id}: content has ${lineCount} lines but file_lines lever is ${i.levers.file_lines}`).toBeGreaterThanOrEqual(i.levers.file_lines)
    }
  })

  it('the unedited file grades as wrong_edit (the original target line does not already satisfy the rule)', () => {
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
    for (const i of instances) {
      const lines = i.given.content.split('\n')
      const targetLine = lines[i.solution.line - 1]
      const targetNorm = norm(targetLine)
      const mustContain: string[] = i.solution.must_contain
      const mustNotContain: string[] = i.solution.must_not_contain ?? []
      const containsAll = mustContain.every((s: string) => targetNorm.includes(norm(s)))
      const containsNone = mustNotContain.every((s: string) => !targetNorm.includes(norm(s)))
      expect(containsAll && containsNone, `${i.id}: the unedited target line already satisfies the rule — the blank answer would grade correct`).toBe(false)
    }
  })

  it('wrong_outcomes include both wrong_edit and collateral_edit entries', () => {
    for (const i of instances) {
      const whens = i.wrong_outcomes.map((w: any) => w.when)
      expect(whens, `${i.id} missing wrong_edit`).toContain('wrong_edit')
      expect(whens, `${i.id} missing collateral_edit`).toContain('collateral_edit')
    }
  })
})
