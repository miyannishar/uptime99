import { describe, it, expect } from 'vitest'
import { gradeAnswer } from '../src/engine/grading'

const instance = {
  solution: {
    accepts: ['checkout-api', 'checkout-api -n prod'],
  },
}

describe('gradeAnswer — terminal format', () => {
  it('returns correct: true when the answer matches one of the accepts entries', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: 'checkout-api' })
    expect(result).toEqual({ correct: true })
  })

  it('returns correct: true for the second accepts entry', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: 'checkout-api -n prod' })
    expect(result).toEqual({ correct: true })
  })

  it('normalises surrounding whitespace', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: '  checkout-api  ' })
    expect(result).toEqual({ correct: true })
  })

  it('normalises interior whitespace runs', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: 'checkout-api  -n  prod' })
    expect(result).toEqual({ correct: true })
  })

  it('is case-sensitive — upper-case does not match', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: 'Checkout-Api' })
    expect(result).toEqual({ correct: false, when: 'wrong_command' })
  })

  it('returns wrong_command for a wrong answer', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: 'search-api' })
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_command')
  })

  it('returns wrong_command for an empty text', () => {
    const result = gradeAnswer(instance, { kind: 'terminal', text: '' })
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_command')
  })
})

describe('terminal trailing punctuation', () => {
  it('treats a closing quote or semicolon as optional', async () => {
    const { gradeAnswer } = await import('../src/engine/grading')
    const inst = { solution: { accepts: ['pg_stat_replication"'] } }
    for (const text of ['pg_stat_replication', 'pg_stat_replication"', 'pg_stat_replication";', '  pg_stat_replication  '])
      expect(gradeAnswer(inst, { kind: 'terminal', text } as any).correct, text).toBe(true)
    expect(gradeAnswer(inst, { kind: 'terminal', text: 'pg_stat_activity' } as any).correct).toBe(false)
  })
})
