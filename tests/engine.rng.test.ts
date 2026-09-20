import { describe, it, expect } from 'vitest'
import { nextInt, nextFloat, seedFrom, rngFrom, type Rng } from '../src/engine/rng'
import { shouldArrive } from '../src/engine/arrival'

const r = (seed: number): Rng => ({ seed })

describe('nextInt', () => {
  it('is deterministic for a given seed', () => {
    expect(nextInt(r(12345), 100).value).toBe(nextInt(r(12345), 100).value)
  })

  it('returns a value within [0, bound)', () => {
    let rng = r(1)
    for (let i = 0; i < 500; i += 1) {
      const out = nextInt(rng, 10)
      expect(out.value).toBeGreaterThanOrEqual(0)
      expect(out.value).toBeLessThan(10)
      rng = out.rng
    }
  })

  it('advances the rng, so successive calls differ', () => {
    const a = nextInt(r(7), 1000)
    const b = nextInt(a.rng, 1000)
    expect(a.rng.seed).not.toBe(7)
    expect([a.value, b.value]).not.toEqual([a.value, a.value])
  })

  it('never returns the same value 20 times running', () => {
    let rng = r(99)
    const seen = new Set<number>()
    for (let i = 0; i < 20; i += 1) {
      const out = nextInt(rng, 6)
      seen.add(out.value)
      rng = out.rng
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('covers the whole range over many draws', () => {
    let rng = r(2024)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i += 1) {
      const out = nextInt(rng, 5)
      seen.add(out.value)
      rng = out.rng
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('throws on a non-positive bound rather than returning a nonsense index', () => {
    expect(() => nextInt(r(1), 0)).toThrow(/bound/)
    expect(() => nextInt(r(1), -3)).toThrow(/bound/)
  })
})

describe('nextFloat', () => {
  it('returns a value in [0, 1)', () => {
    let rng = r(555)
    for (let i = 0; i < 500; i += 1) {
      const out = nextFloat(rng)
      expect(out.value).toBeGreaterThanOrEqual(0)
      expect(out.value).toBeLessThan(1)
      rng = out.rng
    }
  })

  it('is deterministic', () => {
    expect(nextFloat(r(42)).value).toBe(nextFloat(r(42)).value)
  })
})

describe('rngFrom', () => {
  it('scrambles a small seed instead of returning a near-zero first draw', () => {
    // Observed: 0.39315864141099155. Contrast: nextFloat({ seed: 1 }).value is 0.000063.
    // With raw { seed: 1 } the first draw is ~seed * 6.3e-5, well below any useful threshold.
    expect(nextFloat(rngFrom(1)).value).toBeGreaterThan(0.01)
  })

  it('distributes nextInt roughly uniformly across small consecutive seeds', () => {
    // With raw { seed: N } the tally is {"0": 1000} — every seed maps to bucket 0.
    // This test fails if the splitmix32 finaliser is removed.
    // Observed distribution: {0: 341, 1: 331, 2: 328}.
    const tally: Record<number, number> = { 0: 0, 1: 0, 2: 0 }
    for (let s = 1; s <= 1000; s += 1) {
      const v = nextInt(rngFrom(s), 3).value
      tally[v] = (tally[v] ?? 0) + 1
    }
    expect(Object.keys(tally)).toHaveLength(3)
    for (const count of Object.values(tally)) {
      expect(count).toBeGreaterThan(250)
    }
  })

  it('no longer forces an arrival on tick 1 for every small seed', () => {
    // With raw { seed: N } the count is 400 of 400 — every small seed fires on tick 1.
    // Uniform expectation at arrival_mean_ticks 40: about 10 of 400 (2.5%).
    // Observed: 7.
    const difficulty = { arrival_mean_ticks: 40, severity_max: 5, max_concurrent: 3 }
    let count = 0
    for (let s = 1; s <= 400; s += 1) {
      const { arrive } = shouldArrive(difficulty, rngFrom(s))
      if (arrive) count += 1
    }
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(200)
  })

  it('is deterministic', () => {
    // Two calls with the same seed must produce identical Rng values.
    expect(rngFrom(7).seed).toBe(rngFrom(7).seed)
    // Two independent streams from the same seed must produce the same draws.
    let a = rngFrom(7)
    let b = rngFrom(7)
    for (let i = 0; i < 3; i += 1) {
      const fa = nextFloat(a)
      const fb = nextFloat(b)
      expect(fa.value).toBe(fb.value)
      a = fa.rng
      b = fb.rng
    }
  })

  it('never produces a zero seed', () => {
    // 0 is the input most likely to come from an uninitialised field.
    expect(rngFrom(0).seed).not.toBe(0)
    const v = nextFloat(rngFrom(0)).value
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  it('accepts negative and large seeds without producing NaN', () => {
    for (const seed of [-1, 2 ** 31]) {
      const v = nextFloat(rngFrom(seed)).value
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('seedFrom', () => {
  it('is stable for the same string', () => {
    expect(seedFrom('slice-oom-kill')).toBe(seedFrom('slice-oom-kill'))
  })

  it('differs for different strings', () => {
    expect(seedFrom('level-1')).not.toBe(seedFrom('level-2'))
  })

  it('returns a positive integer', () => {
    const s = seedFrom('slice-oom-kill')
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThan(0)
  })
})
