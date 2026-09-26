import { describe, it, expect } from 'vitest'
import { checkRegistryMatchesActions, checkSlotCoverage } from '../src/validate/minigameChecks'

const actions = [{ id: 'up', minigame: 'a', difficulty: 3, minigame_pool: [{ minigame: 'b', difficulty: 2 }] }]

describe('pool-aware minigame checks', () => {
  it('a pool minigame counts as used by an action', () => {
    expect(checkRegistryMatchesActions([{ id: 'a' }, { id: 'b' }], actions)).toEqual([])
  })
  it('a pool minigame missing from the registry is reported', () => {
    expect(checkRegistryMatchesActions([{ id: 'a' }], actions).join()).toMatch(/'b'/)
  })
  it('a pool slot with no instance is reported', () => {
    const out = checkSlotCoverage([{ minigame: 'a', difficulty: 3 }], actions)
    expect(out.join()).toMatch(/b:2/)
  })
})

import { checkForActionsRefs } from '../src/validate/minigameChecks'

describe('for_actions', () => {
  const acts = [
    { id: 'restart', minigame: 'log_triage', difficulty: 1, minigame_pool: [{ minigame: 'shell_fix', difficulty: 2 }] },
    { id: 'flush_cache', minigame: 'cache_key_match', difficulty: 2, minigame_pool: [{ minigame: 'shell_fix', difficulty: 2 }] },
  ]
  const inst = (id: string, for_actions?: string[]) => ({ id, minigame: 'shell_fix', difficulty: 2, for_actions })
  const base = [{ minigame: 'log_triage', difficulty: 1 }, { minigame: 'cache_key_match', difficulty: 2 }]
  it('reports an (action, slot) pair with no eligible instance', () => {
    const out = checkSlotCoverage([...base, inst('x', ['restart'])], acts)
    expect(out.join()).toMatch(/flush_cache/)
    expect(out.join()).toMatch(/shell_fix:2/)
  })
  it('passes when every pooling action has an eligible instance', () => {
    expect(checkSlotCoverage([...base, inst('x', ['restart']), inst('y', ['flush_cache'])], acts)).toEqual([])
  })
  it('rejects for_actions naming an unknown action or one that never selects this minigame', () => {
    expect(checkForActionsRefs([inst('x', ['nope'])], acts).join()).toMatch(/nope/)
    expect(checkForActionsRefs([{ id: 'z', minigame: 'log_triage', difficulty: 1, for_actions: ['flush_cache'] }], acts).join()).toMatch(/flush_cache/)
    expect(checkForActionsRefs([inst('x', ['restart'])], acts)).toEqual([])
  })
})
