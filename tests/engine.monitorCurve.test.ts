import { describe, it, expect } from 'vitest'
import { valueAt, crossingTime } from '../src/engine/monitorCurve'
import type { MonitorMetric } from '../src/engine/monitorCurve'

const flat: MonitorMetric = { id: 'flat', label: 'Flat', unit: '%', start: 50, slope: 0, amplitude: 0, period_s: 1 }
const rising: MonitorMetric = { id: 'rising', label: 'Rising', unit: '%', start: 50, slope: 5, amplitude: 0, period_s: 1 }
const sinusoid: MonitorMetric = { id: 'sin', label: 'Sin', unit: '%', start: 50, slope: 0, amplitude: 10, period_s: 4 }
const falling: MonitorMetric = { id: 'falling', label: 'Falling', unit: '%', start: 100, slope: -5, amplitude: 0, period_s: 1 }

describe('valueAt', () => {
  it('returns start at t=0 when amplitude·sin(0)=0', () => {
    expect(valueAt(flat, 0)).toBe(50)
    expect(valueAt(rising, 0)).toBe(50)
    expect(valueAt(sinusoid, 0)).toBeCloseTo(50, 10)
  })

  it('advances linearly by slope each second', () => {
    expect(valueAt(rising, 1)).toBeCloseTo(55, 10)
    expect(valueAt(rising, 4)).toBeCloseTo(70, 10)
  })

  it('adds sinusoidal oscillation on top of the trend', () => {
    // At t = period/4, sin = 1
    const t = 1 // period_s=4, t=1 → sin(2π*1/4) = sin(π/2) = 1
    expect(valueAt(sinusoid, t)).toBeCloseTo(50 + 10 * 1, 10)
  })

  it('is deterministic: same input always yields same output', () => {
    const v1 = valueAt(rising, 3.14)
    const v2 = valueAt(rising, 3.14)
    expect(v1).toBe(v2)
  })
})

describe('crossingTime', () => {
  it('finds the first time a rising line crosses above a threshold', () => {
    // 50 + 5t = 70 → t = 4; resolution 0.05; floating-point loop may land at 4.0 or 4.05
    const t = crossingTime(rising, 70, 'above', 30)
    expect(t).not.toBeNull()
    expect(t!).toBeCloseTo(4.0, 1)
  })

  it('finds the first time a falling line crosses below a threshold', () => {
    // 100 - 5t = 80 → t = 4; resolution 0.05; floating-point loop may land at 4.0 or 4.05
    const t = crossingTime(falling, 80, 'below', 30)
    expect(t).not.toBeNull()
    expect(t!).toBeCloseTo(4.0, 1)
  })

  it('returns null when the threshold is never crossed within durationS', () => {
    // flat line at 50, look for above 90
    expect(crossingTime(flat, 90, 'above', 30)).toBeNull()
  })

  it('returns 0 when the curve starts at or beyond the threshold', () => {
    // rising starts at 50, which is already above 40
    expect(crossingTime(rising, 40, 'above', 30)).toBe(0)
  })

  it('is deterministic', () => {
    const t1 = crossingTime(rising, 70, 'above', 30)
    const t2 = crossingTime(rising, 70, 'above', 30)
    expect(t1).toBe(t2)
  })
})

describe('valueAt bounds', () => {
  it('clamps to floor and ceil when given', async () => {
    const { valueAt } = await import('../src/engine/monitorCurve')
    const m = { id: 'q', label: 'q', unit: '', start: 100, slope: -50, amplitude: 0, period_s: 1, floor: 0, ceil: 120 }
    expect(valueAt(m, 10)).toBe(0)
    expect(valueAt({ ...m, slope: 50 }, 10)).toBe(120)
  })
})
