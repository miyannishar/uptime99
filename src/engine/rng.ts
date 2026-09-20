/* A deterministic 32-bit xorshift PRNG, expressed as a pure function.
   The engine is pure and `advance` returns new state, so the generator's
   position must travel in that state rather than living in a closure —
   hence every call returns both a value and the next Rng. Math.random is
   prohibited: a run must be reproducible from its seed alone, which is what
   makes free play's weighted arrivals replayable and the golden-run test
   possible. */

export type Rng = { readonly seed: number }

function step(seed: number): number {
  // xorshift32. Kept in uint32 space with >>> 0 after each operation.
  let x = seed | 0
  if (x === 0) x = 0x9e3779b9 // a zero seed is a fixed point; nudge it off
  x ^= x << 13
  x >>>= 0
  x ^= x >>> 17
  x ^= x << 5
  x >>>= 0
  return x
}

export function nextFloat(rng: Rng): { value: number; rng: Rng } {
  const s = step(rng.seed)
  return { value: s / 0x100000000, rng: { seed: s } }
}

export function nextInt(rng: Rng, boundExclusive: number): { value: number; rng: Rng } {
  if (!Number.isInteger(boundExclusive) || boundExclusive < 1) {
    throw new Error(`rng: bound must be a positive integer, got ${boundExclusive}`)
  }
  const { value, rng: next } = nextFloat(rng)
  return { value: Math.floor(value * boundExclusive), rng: next }
}

/**
 * Build an Rng from an arbitrary integer seed.
 *
 * xorshift32 has almost no avalanche on its first output from a small seed — the
 * first draw is roughly `seed * 6.3e-5`, so `nextInt(1, 3)` is 0 and
 * `shouldArrive` fires on tick 1 for every seed below a few hundred. A run seeded
 * from a counter or a player-typed number would open with a guaranteed incident.
 * This applies a splitmix32 finaliser so the seed is well mixed before first use.
 *
 * Prefer this over constructing `{ seed }` by hand anywhere the first draw matters.
 */
export function rngFrom(seed: number): Rng {
  let x = ((seed | 0) + 0x9e3779b9) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x21f0aaad) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x735a2d97) >>> 0
  x ^= x >>> 15
  return { seed: (x >>> 0) || 1 }
}

/** Stable 32-bit hash so a scenario id can seed a run reproducibly. */
export function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) || 1
}
