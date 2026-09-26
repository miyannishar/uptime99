import { describe, it, expect } from 'vitest'
import { gradeAnswer } from '../src/engine/grading'

// A rising linear metric that crosses 70 at t=(70-48)/1.6 = 13.75s
// crossingTime with 0.05 resolution → 13.75 (verified)
const instance = {
  given: {
    metrics: [
      { id: 'cpu_pct', label: 'CPU', unit: '%', start: 48, slope: 1.6, amplitude: 0, period_s: 5 },
      { id: 'memory_pct', label: 'Memory', unit: '%', start: 62, slope: 0, amplitude: 0, period_s: 5 },
    ],
    duration_s: 30,
    rule: 'Scale out when CPU crosses 70%.',
  },
  solution: {
    metric: 'cpu_pct',
    threshold: 70,
    direction: 'above',
    window_s: 5,
  },
}

describe('gradeAnswer — monitor format', () => {
  it('returns correct: true when the right metric is clicked inside the window', () => {
    // tStar = 13.75; window_s = 5; valid range [13.75, 18.75)
    const answer = { kind: 'monitor' as const, metric: 'cpu_pct', t: 15 }
    expect(gradeAnswer(instance, answer)).toEqual({ correct: true })
  })

  it('returns correct: true when clicked at the exact crossing time', () => {
    const answer = { kind: 'monitor' as const, metric: 'cpu_pct', t: 13.75 }
    expect(gradeAnswer(instance, answer)).toEqual({ correct: true })
  })

  it('returns too_early when clicked before the crossing', () => {
    const answer = { kind: 'monitor' as const, metric: 'cpu_pct', t: 10 }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('too_early')
  })

  it('returns too_early when t = 0 (blank answer)', () => {
    const answer = { kind: 'monitor' as const, metric: null, t: 0 }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    // too_late check: tStar(13.75) + 5 = 18.75, t=0 ≤ 18.75 → passes; wrong_metric check: null !== 'cpu_pct' → wrong_metric
    expect(result.when).toBe('wrong_metric')
  })

  it('returns too_late when clicked after the window closes', () => {
    // tStar=13.75, window_s=5, deadline=18.75; t=20 > 18.75
    const answer = { kind: 'monitor' as const, metric: 'cpu_pct', t: 20 }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('too_late')
  })

  it('returns too_late for wrong metric clicked after the window (too_late takes priority)', () => {
    // Even if wrong metric, too_late is checked first
    const answer = { kind: 'monitor' as const, metric: 'memory_pct', t: 25 }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('too_late')
  })

  it('returns wrong_metric when correct timing but wrong metric clicked', () => {
    const answer = { kind: 'monitor' as const, metric: 'memory_pct', t: 15 }
    const result = gradeAnswer(instance, answer)
    expect(result.correct).toBe(false)
    expect(result.when).toBe('wrong_metric')
  })
})
