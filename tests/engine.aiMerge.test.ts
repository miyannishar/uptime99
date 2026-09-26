import { describe, it, expect } from 'vitest'
import { readPath, validateAiPatch, applyAiPatch, type AiPatch } from '../src/engine/aiMerge'

const AI_FIELDS = ['brief', 'wrong_outcomes[].shows'] as const

/** Frozen base instance to ensure applyAiPatch never mutates its input. */
const baseInstance = Object.freeze({
  id: 'test_workers',
  brief: 'The pool of 12 threads is exhausted. Adjust the worker count to handle 4,800 requests per second.',
  teaches: 'Thread pools need headroom above peak load.',
  given: {
    table: [
      { label: 'Workers', value: '12' },
      { label: 'Load', value: '4,800 req/s' },
    ],
    unit: 'workers',
    range: { min: 1, max: 50 },
  },
  solution: { value: 16 },
  wrong_outcomes: [
    {
      when: 'below',
      shows: 'With 8 workers the queue immediately fills. Latency spikes to 340 ms.',
      why_wrong: 'Under-provisioned.',
    },
    {
      when: 'above',
      shows: 'With 50 workers each sits idle for over 80% of its time. Cost doubles.',
      why_wrong: 'Over-provisioned.',
    },
  ],
})

// ---------------------------------------------------------------------------
// readPath
// ---------------------------------------------------------------------------

describe('readPath', () => {
  it('reads brief', () => {
    expect(readPath(baseInstance, 'brief')).toBe(baseInstance.brief)
  })

  it('reads reveal (undefined when absent)', () => {
    expect(readPath(baseInstance, 'reveal')).toBeUndefined()
  })

  it('reads wrong_outcomes[].shows as string[]', () => {
    expect(readPath(baseInstance, 'wrong_outcomes[].shows')).toEqual([
      'With 8 workers the queue immediately fills. Latency spikes to 340 ms.',
      'With 50 workers each sits idle for over 80% of its time. Cost doubles.',
    ])
  })

  it('reads given sub-key', () => {
    expect(readPath(baseInstance, 'given.unit')).toBe('workers')
  })

  it('returns undefined for an unknown path', () => {
    expect(readPath(baseInstance, 'nonexistent')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// validateAiPatch
// ---------------------------------------------------------------------------

describe('validateAiPatch', () => {
  it('accepts a valid brief rewrite that preserves numbers', () => {
    const patch: AiPatch = {
      brief:
        'pg-primary is running on 12 worker threads but is receiving 4,800 requests per second. Scale the pool up.',
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('drops an unknown key; ok stays true when another known key passes', () => {
    const patch: AiPatch = {
      brief:
        'pg-primary is using 12 workers to serve 4,800 requests per second. The pool is saturated.',
      teaches: 'Unknown field — should be reported but not fail.',
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(true)
    expect(result.reasons.some((r) => r.includes('teaches') && r.includes('unknown'))).toBe(true)
  })

  it('returns ok:false when only unknown keys are present', () => {
    const patch: AiPatch = { teaches: 'Only unknown key here.' }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
  })

  it('fails on type mismatch — string field given an array', () => {
    const patch: AiPatch = { brief: ['not', 'a', 'string'] }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes("'brief'"))).toBe(true)
  })

  it('fails on wrong_outcomes[].shows length mismatch', () => {
    const patch: AiPatch = {
      'wrong_outcomes[].shows': [
        'Only one entry provided but two are required here.',
      ],
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('length mismatch'))).toBe(true)
  })

  it('fails when a number is dropped from the rewrite ("pool of 12 threads" → "pool of threads")', () => {
    const instanceWithThreads = { ...baseInstance, brief: 'The pool of 12 threads is exhausted.' }
    const patch: AiPatch = {
      brief: 'The pool of threads is exhausted on the primary database node under load.',
    }
    const result = validateAiPatch(instanceWithThreads, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('12') && r.includes('dropped'))).toBe(true)
  })

  it('fails when {{node_name}} template brace is left in the patch', () => {
    const patch: AiPatch = {
      brief: '{{node_name}} has 12 workers handling 4,800 requests per second. Increase the pool.',
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('template braces'))).toBe(true)
  })

  it('fails when a string is over 700 chars', () => {
    const longBrief = 'A'.repeat(690) + ' 12 workers and 4,800 req/s.'
    expect(longBrief.length).toBeGreaterThan(700)
    const patch: AiPatch = { brief: longBrief }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('too long'))).toBe(true)
  })

  it('fails when a string is under 20 chars', () => {
    const patch: AiPatch = { brief: '12 workers fail.' }  // 16 chars
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('too short'))).toBe(true)
  })

  it('validates wrong_outcomes[].shows elements independently', () => {
    const patch: AiPatch = {
      'wrong_outcomes[].shows': [
        // [0] drops number 8 → should fail
        'With too few workers the queue immediately fills. Latency spikes to 340 ms.',
        // [1] is valid
        'With 50 workers each sits idle for over 80% of its time. Monthly cost doubles.',
      ],
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('[0]') && r.includes('8') && r.includes('dropped'))).toBe(true)
  })

  it('accepts wrong_outcomes[].shows when all elements are valid', () => {
    const patch: AiPatch = {
      'wrong_outcomes[].shows': [
        'Running 8 workers saturates the pool; queue depth climbs to 340 ms of lag.',
        'At 50 workers over 80% of capacity sits idle and monthly costs double.',
      ],
    }
    const result = validateAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// applyAiPatch
// ---------------------------------------------------------------------------

describe('applyAiPatch', () => {
  it('returns a new object with patched brief while leaving the original frozen instance unchanged', () => {
    const newBrief =
      'pg-primary has 12 worker threads and is receiving 4,800 requests per second.'
    const patch: AiPatch = { brief: newBrief }
    const result = applyAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.brief).toBe(newBrief)
    // Original is frozen and unchanged
    expect(baseInstance.brief).not.toBe(newBrief)
  })

  it('applies wrong_outcomes[].shows, leaving other wrong_outcome fields intact', () => {
    const newShows = [
      'At 8 workers the queue depth climbs to 340 ms of lag on the primary node.',
      'At 50 workers 80% of capacity is idle; cost doubles each month.',
    ]
    const patch: AiPatch = { 'wrong_outcomes[].shows': newShows }
    const result = applyAiPatch(baseInstance, AI_FIELDS, patch)
    const outcomes = (result as any).wrong_outcomes
    expect(outcomes[0].shows).toBe(newShows[0])
    expect(outcomes[1].shows).toBe(newShows[1])
    // Non-shows fields preserved
    expect(outcomes[0].when).toBe('below')
    expect(outcomes[1].why_wrong).toBe('Over-provisioned.')
  })

  it('never touches solution — deep-equal to original', () => {
    const patch: AiPatch = {
      solution: { value: 999 },
      brief:
        'pg-primary has 12 worker threads handling 4,800 requests per second on the primary node.',
    }
    const result = applyAiPatch(baseInstance, AI_FIELDS, patch)
    expect((result as any).solution).toEqual(baseInstance.solution)
    expect((result as any).solution.value).toBe(16)
  })

  it('drops unknown keys silently — does not write them to the result', () => {
    const patch: AiPatch = {
      brief:
        'pg-primary has 12 workers processing 4,800 requests per second. The pool is saturated.',
      teaches: 'This should be silently dropped from the output.',
    }
    const result = applyAiPatch(baseInstance, AI_FIELDS, patch)
    expect((result as any).teaches).toBe(baseInstance.teaches)
  })

  it('handles both brief and wrong_outcomes[].shows in one patch', () => {
    const newBrief =
      'pg-primary pool: 12 workers, 4,800 req/s inbound. Scale up the worker count now.'
    const newShows = [
      'At 8 workers load exceeds capacity; queue fills to 340 ms of lag.',
      'At 50 workers each idles at 80% of its time; cost doubles every month.',
    ]
    const patch: AiPatch = {
      brief: newBrief,
      'wrong_outcomes[].shows': newShows,
    }
    const result = applyAiPatch(baseInstance, AI_FIELDS, patch)
    expect(result.brief).toBe(newBrief)
    expect((result as any).wrong_outcomes[0].shows).toBe(newShows[0])
    expect((result as any).wrong_outcomes[1].shows).toBe(newShows[1])
    expect((result as any).solution).toEqual(baseInstance.solution)
  })
})
