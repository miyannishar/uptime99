import { describe, it, expect } from 'vitest'
import { gradeAnswer } from '../src/engine/grading'

const content = [
  '# database.yml',
  'production:',
  '  adapter: postgresql',
  '  pool: 5',
  '  timeout: 5000',
].join('\n')

const instance = {
  given: { filename: 'config/database.yml', language: 'yaml', content },
  solution: {
    line: 4,
    must_contain: ['pool: 12'],
    must_not_contain: ['pool: 5'],
  },
}

function withLine(lineNum: number, replacement: string): string {
  const lines = content.split('\n')
  lines[lineNum - 1] = replacement
  return lines.join('\n')
}

describe('gradeAnswer — patch format', () => {
  it('returns correct: true when the target line satisfies must_contain and not must_not_contain', () => {
    const answer = { kind: 'patch' as const, content: withLine(4, '  pool: 12') }
    expect(gradeAnswer(instance, answer)).toEqual({ correct: true })
  })

  it('is case-insensitive for the semantic comparison', () => {
    const answer = { kind: 'patch' as const, content: withLine(4, '  POOL: 12') }
    expect(gradeAnswer(instance, answer)).toEqual({ correct: true })
  })

  it('returns wrong_edit when the target line fails must_contain', () => {
    const answer = { kind: 'patch' as const, content: withLine(4, '  pool: 8') }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_edit')
  })

  it('returns wrong_edit when the target line contains a must_not_contain string', () => {
    // pool: 5 still present in target line
    const answer = { kind: 'patch' as const, content: withLine(4, '  pool: 5  # keep') }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_edit')
  })

  it('returns wrong_edit for the unedited file (blank answer)', () => {
    const answer = { kind: 'patch' as const, content }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_edit')
  })

  it('returns collateral_edit when a non-target line is changed', () => {
    const answer = { kind: 'patch' as const, content: withLine(3, '  adapter: mysql') }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('collateral_edit')
  })

  it('returns collateral_edit when the line count changes (a line is added)', () => {
    const answer = { kind: 'patch' as const, content: content + '\n  extra: line' }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('collateral_edit')
  })

  it('returns collateral_edit when a line is deleted', () => {
    const lines = content.split('\n')
    lines.splice(2, 1)
    const answer = { kind: 'patch' as const, content: lines.join('\n') }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('collateral_edit')
  })

  it('collateral_edit takes priority over wrong_edit (both violated simultaneously)', () => {
    // Target line also wrong AND a non-target line changed
    const lines = content.split('\n')
    lines[1] = '  production:  # changed'
    lines[3] = '  pool: 99'
    const answer = { kind: 'patch' as const, content: lines.join('\n') }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('collateral_edit')
  })
})

describe('patch matching normalisation', () => {
  it('ignores spacing around : and =, and matches on token boundaries', async () => {
    const { gradeAnswer } = await import('../src/engine/grading')
    const mk = (line: string, must: string[], not: string[] = []) => gradeAnswer(
      { given: { content: 'a\nORIG\nb' }, solution: { line: 2, must_contain: must, must_not_contain: not } },
      { kind: 'patch', content: `a\n${line}\nb` } as any)
    expect(mk('  pool:12', ['pool: 12']).correct).toBe(true)
    expect(mk('rate = 20r/s;', ['rate=20r/s']).correct).toBe(true)
    expect(mk('api 600 IN A 1.2.3.4', ['api 60']).correct).toBe(false)
    expect(mk('api 60 IN A 1.2.3.4', ['api 60'], ['3600']).correct).toBe(true)
  })
})
