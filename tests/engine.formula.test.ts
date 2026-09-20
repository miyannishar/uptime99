import { describe, it, expect } from 'vitest'
import { evaluateFormula, ALLOWED_FUNCTIONS } from '../src/engine/formula'

const scope = {
  scalars: { users: 1000, arpu: 0.1, cost_month: 115, reputation: 100,
             incident_severity: 0, saturation_knee: 0.8, saturation_exponent: 3,
             reputation_decay_per_tick: 1.5, reputation_recovery_per_tick: 0.2 },
  vectors: {
    'node.blast_radius': [0.4, 0.1, 0.5],
    'node.down': [0, 0, 1],
    'path.base_latency_ms': [15, 4, 45, 8],
    'path.utilization_pct': [22, 31, 97, 40],
    'instance.cost_month': [20, 20, 25, 50],
    'instance.usage_cost': [],
    'ledger.recurring': [],
  },
}

describe('evaluateFormula', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', scope)).toBe(14)
    expect(evaluateFormula('(2 + 3) * 4', scope)).toBe(20)
  })

  it('handles unary minus', () => {
    expect(evaluateFormula('-5 + 2', scope)).toBe(-3)
  })

  it('resolves scalars', () => {
    expect(evaluateFormula('users * arpu', scope)).toBeCloseTo(100)
  })

  it('reduces a vector with sum, multiplying elementwise first', () => {
    // 0.4*0 + 0.1*0 + 0.5*1
    expect(evaluateFormula('sum(node.blast_radius * node.down)', scope)).toBeCloseTo(0.5)
  })

  it('computes uptime_pct as shipped', () => {
    expect(evaluateFormula(
      'clamp(100 - sum(node.blast_radius * node.down), 0, 100)', scope,
    )).toBeCloseTo(99.5)
  })

  it('computes p95_latency_ms as shipped', () => {
    // saturation_curve is 1 below the 0.8 knee; only 0.97 bites: 1+(0.17/0.2)^3
    const v = evaluateFormula(
      'sum(path.base_latency_ms * saturation_curve(path.utilization_pct / 100))', scope,
    )
    expect(v).toBeCloseTo(99.64, 1)
  })

  it('computes error_rate_pct as shipped, clamping the negative case to zero', () => {
    // All utilisations under 100%: max of negatives clamps to 0
    expect(evaluateFormula(
      'clamp(max(path.utilization_pct / 100 - 1) * 40, 0, 100)', scope,
    )).toBe(0)
  })

  it('computes error_rate_pct with a saturated node', () => {
    // utilization_pct = [22, 31, 150, 40]: max(0.22-1, 0.31-1, 0.50, 0.40-1) = 0.50
    // 0.50 * 40 = 20, clamp(20, 0, 100) = 20
    const saturatedScope = {
      ...scope,
      vectors: { ...scope.vectors, 'path.utilization_pct': [22, 31, 150, 40] },
    }
    expect(evaluateFormula(
      'clamp(max(path.utilization_pct / 100 - 1) * 40, 0, 100)', saturatedScope,
    )).toBe(20)
  })

  it('sums empty vectors to zero', () => {
    expect(evaluateFormula('sum(instance.cost_month) + sum(ledger.recurring)', scope)).toBe(115)
  })

  it('takes max over two scalars', () => {
    expect(evaluateFormula('max(users * 0 - 5, 0)', scope)).toBe(0)
  })

  it('exposes exactly the six allowed functions', () => {
    expect([...ALLOWED_FUNCTIONS].sort()).toEqual(
      ['clamp', 'decay', 'max', 'min', 'saturation_curve', 'sum'],
    )
  })

  it('decay: severity above zero decays reputation', () => {
    // reputation_decay_per_tick=1.5, severity=2 → 100 - 1.5*2 = 97
    expect(evaluateFormula('decay(reputation, incident_severity)', {
      ...scope,
      scalars: { ...scope.scalars, incident_severity: 2 },
    })).toBe(97)
  })

  it('decay: severity zero recovers reputation', () => {
    // reputation_recovery_per_tick=0.2, severity=0 → 97 + 0.2 = 97.2
    expect(evaluateFormula('decay(reputation, incident_severity)', {
      ...scope,
      scalars: { ...scope.scalars, reputation: 97, incident_severity: 0 },
    })).toBeCloseTo(97.2)
  })
})

describe('evaluateFormula — failing loudly', () => {
  it('throws on an unknown identifier rather than defaulting to zero', () => {
    expect(() => evaluateFormula('mystery_term + 1', scope)).toThrow(/mystery_term/)
  })

  it('throws on an unknown function', () => {
    expect(() => evaluateFormula('sqrt(4)', scope)).toThrow(/sqrt/)
  })

  it('refuses to execute arbitrary code', () => {
    expect(() => evaluateFormula('process.exit(1)', scope)).toThrow()
    expect(() => evaluateFormula('constructor', scope)).toThrow(/constructor/)
  })

  it('decay: throws when reputation_decay_per_tick is missing from scope (M4)', () => {
    const noDecay = {
      ...scope,
      scalars: { ...scope.scalars, reputation_decay_per_tick: undefined as unknown as number },
    }
    expect(() => evaluateFormula('decay(reputation, incident_severity)', {
      ...noDecay,
      scalars: Object.fromEntries(
        Object.entries(noDecay.scalars).filter(([k]) => k !== 'reputation_decay_per_tick'),
      ) as typeof scope.scalars,
    })).toThrow(/reputation_decay_per_tick/)
  })

  it('decay: throws when reputation_recovery_per_tick is missing from scope (M4)', () => {
    expect(() => evaluateFormula('decay(reputation, incident_severity)', {
      ...scope,
      scalars: Object.fromEntries(
        Object.entries(scope.scalars).filter(([k]) => k !== 'reputation_recovery_per_tick'),
      ) as typeof scope.scalars,
    })).toThrow(/reputation_recovery_per_tick/)
  })

  it('throws on an unbalanced parenthesis', () => {
    // Must be a formula whose ONLY defect is the missing ')'; the inner expression
    // must be valid on its own. If the inner expression also has a length mismatch
    // the evaluator throws for that reason before it checks the closing paren,
    // and the test no longer targets what it claims.
    expect(() => evaluateFormula('sum(1 + 2', scope)).toThrow()
  })

  it('throws when two vectors of different length are combined', () => {
    expect(() => evaluateFormula('sum(node.down * path.base_latency_ms)', scope))
      .toThrow(/length/)
  })

  it('throws when a vector is used where a number is required', () => {
    // Broadcasting works internally — wrap in sum to prove it reduces correctly:
    // node.down + 1 broadcasts [0,0,1]+1 = [1,1,2], sum = 4
    expect(evaluateFormula('sum(node.down + 1)', scope)).toBe(4)
    // But the top-level result must always be a single number
    expect(() => evaluateFormula('node.down + 1', scope)).toThrow(/single number/)
    expect(() => evaluateFormula('clamp(node.down, 0, 1) * 1', scope)).toThrow(/single number/)
    expect(() => evaluateFormula('node.down', scope)).toThrow(/single number/)
  })
})
