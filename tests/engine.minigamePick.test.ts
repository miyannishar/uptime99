import { describe, it, expect } from 'vitest'
import { slotsFor, pickSlot, pickInstance } from '../src/engine/minigamePick'

const plain = { id: 'restart', minigame: 'log_triage', difficulty: 1 }
const pooled = {
  id: 'upgrade_tier', minigame: 'capacity_planning', difficulty: 3,
  minigame_pool: [{ minigame: 'tier_migration', difficulty: 3 }, { minigame: 'terraform_resize', difficulty: 3 }],
}

describe('minigamePick', () => {
  it('slot 0 is always the action\'s own minigame', () => {
    expect(slotsFor(plain)).toEqual([{ minigame: 'log_triage', difficulty: 1 }])
    expect(slotsFor(pooled)[0]).toEqual({ minigame: 'capacity_planning', difficulty: 3 })
    expect(slotsFor(pooled)).toHaveLength(3)
  })
  it('an action without a pool always picks slot 0', () => {
    for (let i = 0; i < 50; i++) expect(pickSlot(plain, `k${i}`, 12345)).toEqual(slotsFor(plain)[0])
  })
  it('is deterministic for the same inputs', () => {
    expect(pickSlot(pooled, 'incident:abc', 99)).toEqual(pickSlot(pooled, 'incident:abc', 99))
    expect(pickInstance(['a', 'b', 'c'], 'ticket:x', 7)).toBe(pickInstance(['a', 'b', 'c'], 'ticket:x', 7))
  })
  it('spreads across every slot over 100 context keys', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) seen.add(pickSlot(pooled, `ticket:${i}`, 42).minigame)
    expect(seen).toEqual(new Set(['capacity_planning', 'tier_migration', 'terraform_resize']))
  })
  it('pickInstance returns undefined for an empty pool', () => {
    expect(pickInstance([], 'k', 1)).toBeUndefined()
  })
})

import { eligibleInstances } from '../src/engine/minigamePick'

describe('eligibleInstances', () => {
  const pool = [{ id: 'a' }, { id: 'b', for_actions: ['restart'] }, { id: 'c', for_actions: ['rollback_deploy'] }]
  it('keeps unrestricted instances and those naming the action', () => {
    expect(eligibleInstances(pool, 'restart').map((i) => i.id)).toEqual(['a', 'b'])
  })
  it('drops instances restricted to other actions', () => {
    expect(eligibleInstances(pool, 'flush_cache').map((i) => i.id)).toEqual(['a'])
  })
})
