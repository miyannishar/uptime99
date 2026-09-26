import { describe, it, expect } from 'vitest'
import { gradeAnswer } from '../src/engine/grading'

const instance = {
  solution: {
    line: 14,
  },
}

describe('gradeAnswer — log_hunt format', () => {
  it('returns correct: true when the answer line matches solution.line', () => {
    const result = gradeAnswer(instance, { kind: 'log_hunt', line: 14 })
    expect(result).toEqual({ correct: true })
  })

  it('returns wrong_line for a different line number', () => {
    const result = gradeAnswer(instance, { kind: 'log_hunt', line: 7 })
    expect(result).toEqual({ correct: false, when: 'wrong_line' })
  })

  it('returns wrong_line for line: null (blank answer)', () => {
    const result = gradeAnswer(instance, { kind: 'log_hunt', line: null })
    expect(result).toEqual({ correct: false, when: 'wrong_line' })
  })

  it('returns wrong_line for line 1 when solution is 14', () => {
    const result = gradeAnswer(instance, { kind: 'log_hunt', line: 1 })
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_line')
  })
})

describe('log_hunt accept list', () => {
  it('grades any accepted line as correct', async () => {
    const { gradeAnswer } = await import('../src/engine/grading')
    const inst = { solution: { line: 3, accept: [7, 9] } }
    expect(gradeAnswer(inst, { kind: 'log_hunt', line: 7 } as any).correct).toBe(true)
    expect(gradeAnswer(inst, { kind: 'log_hunt', line: 4 } as any)).toEqual({ correct: false, when: 'wrong_line' })
  })
})
