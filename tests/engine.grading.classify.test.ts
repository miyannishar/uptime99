import { describe, it, expect } from 'vitest'
import { gradeAnswer } from '../src/engine/grading'

const instance = {
  given: {
    items: [
      { id: 'p95_latency', label: 'p95 latency per endpoint' },
      { id: 'request_count', label: 'request count per minute' },
      { id: 'stack_trace', label: 'stack trace of a 500' },
      { id: 'audit_line', label: 'audit line: user 812 changed billing email' },
    ],
    bins: [
      { id: 'metrics', label: 'Metrics' },
      { id: 'logs', label: 'Logs' },
      { id: 'traces', label: 'Traces' },
    ],
  },
  solution: {
    bins: {
      p95_latency: 'metrics',
      request_count: 'metrics',
      stack_trace: 'logs',
      audit_line: 'logs',
    },
  },
}

describe('gradeAnswer — classify format', () => {
  it('returns correct: true when every item is in its correct bin', () => {
    const answer = {
      kind: 'classify' as const,
      placements: {
        p95_latency: 'metrics',
        request_count: 'metrics',
        stack_trace: 'logs',
        audit_line: 'logs',
      },
    }
    expect(gradeAnswer(instance, answer)).toEqual({ correct: true })
  })

  it('returns wrong_bin when one item is in the wrong bin', () => {
    const answer = {
      kind: 'classify' as const,
      placements: {
        p95_latency: 'logs',  // wrong
        request_count: 'metrics',
        stack_trace: 'logs',
        audit_line: 'logs',
      },
    }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_bin')
  })

  it('returns wrong_bin when placements is empty', () => {
    const answer = { kind: 'classify' as const, placements: {} }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_bin')
  })

  it('returns wrong_bin when only some items are placed', () => {
    const answer = {
      kind: 'classify' as const,
      placements: {
        p95_latency: 'metrics',
        request_count: 'metrics',
        // stack_trace and audit_line missing
      },
    }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_bin')
  })
})
