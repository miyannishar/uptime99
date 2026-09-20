import { describe, it, expect } from 'vitest'
import { runIntegrityChecks } from '../src/validate/integrity'
import {
  loadMinigameData, checkRegistryMatchesActions, checkFormatsResolve,
  checkSlotCoverage, checkInstanceRefs, checkInstanceIdsUnique,
  checkInstanceShapes, checkWhenLegality,
} from '../src/validate/minigameChecks'
import { loadJson } from '../src/validate/loadJson'

const d = loadMinigameData()
const actions = loadJson<any>('data/actions.json').actions

describe('the shipped minigame data', () => {
  it('reports no integrity problems at all', () => {
    expect(runIntegrityChecks()).toEqual([])
  })

  it('loads 5 formats, 15 minigames and 32 instances', () => {
    expect(d.formats).toHaveLength(5)
    expect(d.minigames).toHaveLength(15)
    expect(d.instances).toHaveLength(32)
  })
})

describe('checkRegistryMatchesActions', () => {
  it('passes on the real data', () => {
    expect(checkRegistryMatchesActions(d.minigames, actions)).toEqual([])
  })
  it('fires when an action references a minigame the registry lacks', () => {
    const bad = structuredClone(actions)
    bad[0].minigame = 'ghost_minigame'
    expect(checkRegistryMatchesActions(d.minigames, bad).join()).toMatch(/ghost_minigame/)
  })
  it('fires when the registry holds a minigame no action uses', () => {
    const bad = structuredClone(d.minigames)
    bad.push({ id: 'orphan_game', name: 'Orphan', format: 'dial', description: 'x'.repeat(30) })
    expect(checkRegistryMatchesActions(bad, actions).join()).toMatch(/orphan_game/)
  })
})

describe('checkFormatsResolve', () => {
  it('passes on the real data', () => {
    expect(checkFormatsResolve(d.minigames, d.formats)).toEqual([])
  })
  it('fires on a minigame naming an unknown format', () => {
    const bad = structuredClone(d.minigames)
    bad[0].format = 'interpretive_dance'
    expect(checkFormatsResolve(bad, d.formats).join()).toMatch(/interpretive_dance/)
  })
})

describe('checkSlotCoverage', () => {
  it('passes — all 24 difficulty-slots have an instance', () => {
    expect(checkSlotCoverage(d.instances, actions)).toEqual([])
  })
  it('fires when a demanded slot has no instance', () => {
    const bad = d.instances.filter((i: any) => i.minigame !== 'log_triage')
    expect(checkSlotCoverage(bad, actions).join()).toMatch(/log_triage/)
  })
  it('reports 24 slots as the required total', () => {
    const slots = new Set(actions.map((a: any) => `${a.minigame}:${a.difficulty}`))
    expect(slots.size).toBe(24)
  })
})

describe('checkInstanceRefs', () => {
  it('passes on the real data', () => {
    expect(checkInstanceRefs(d.instances, d.minigames, d.formats)).toEqual([])
  })
  it('fires on an instance naming an unknown minigame', () => {
    const bad = structuredClone(d.instances)
    bad[0].minigame = 'not_a_minigame'
    expect(checkInstanceRefs(bad, d.minigames, d.formats).join()).toMatch(/not_a_minigame/)
  })
  it('fires on a lever the format does not declare', () => {
    const bad = structuredClone(d.instances)
    bad[0].levers = { ...bad[0].levers, vibes: 11 }
    expect(checkInstanceRefs(bad, d.minigames, d.formats).join()).toMatch(/vibes/)
  })
})

describe('checkInstanceIdsUnique', () => {
  it('passes on the real data', () => {
    expect(checkInstanceIdsUnique(d.instances)).toEqual([])
  })
  it('fires on a duplicate id across files', () => {
    const bad = [...d.instances, d.instances[0]]
    expect(checkInstanceIdsUnique(bad).join()).toMatch(new RegExp(d.instances[0].id))
  })
})

describe('checkInstanceShapes', () => {
  // the schema types given/solution as bare objects, so these checks are the
  // only thing standing between a typo and a silently broken instance
  const firstOf = (format: string) => {
    const ids = new Set(d.minigames.filter((m: any) => m.format === format).map((m: any) => m.id))
    const i = d.instances.find((x: any) => ids.has(x.minigame))
    if (!i) throw new Error(`no instance found for format '${format}'`)
    return i
  }

  it('passes on the real data', () => {
    expect(checkInstanceShapes(d.instances, d.minigames)).toEqual([])
  })

  it.each([
    ['evidence', 'choice'],
    ['dial', 'value'],
    ['ordered_sequence', 'order'],
    ['fill_blank', 'blanks'],
    ['wiring', 'zone'],
  ])('fires when a %s instance loses solution.%s to a typo', (format, key) => {
    const victim = structuredClone(firstOf(format))
    victim.solution[`${key}_typo`] = victim.solution[key]
    delete victim.solution[key]
    const out = checkInstanceShapes([victim], d.minigames).join()
    expect(out).toMatch(new RegExp(victim.id))
    expect(out).toMatch(new RegExp(`solution\\.${key}`))
  })

  it('fires on a given key of the wrong type', () => {
    const victim = structuredClone(firstOf('dial'))
    victim.given.unit = ''
    expect(checkInstanceShapes([victim], d.minigames).join()).toMatch(/given\.unit/)
  })

  it('fires on a dial range missing numeric bounds', () => {
    const victim = structuredClone(firstOf('dial'))
    victim.given.range = { min: 1 }
    expect(checkInstanceShapes([victim], d.minigames).join()).toMatch(/given\.range/)
  })

  it('reports rather than throws when solution is missing entirely', () => {
    const victim = structuredClone(firstOf('evidence'))
    delete victim.solution
    expect(() => checkInstanceShapes([victim], d.minigames)).not.toThrow()
    expect(checkInstanceShapes([victim], d.minigames).join()).toMatch(/solution must be an object/)
  })

  it('stays silent on an unknown minigame, leaving that to checkInstanceRefs', () => {
    const victim = structuredClone(d.instances[0])
    victim.minigame = 'not_a_minigame'
    expect(checkInstanceShapes([victim], d.minigames)).toEqual([])
  })

  it('allows optional extra keys the formats legitimately carry', () => {
    const victim = structuredClone(firstOf('wiring'))
    victim.given.edges = [{ from: 'a', to: 'b' }]
    victim.given.some_future_field = 'x'
    expect(checkInstanceShapes([victim], d.minigames)).toEqual([])
  })
})

describe('checkWhenLegality', () => {
  it('passes on the real data', () => {
    expect(checkWhenLegality(d.instances, d.minigames)).toEqual([])
  })

  it('fires on a dial instance carrying wrong_order', () => {
    const victim = structuredClone(d.instances.find((i: any) => i.minigame === 'queue_triage'))
    victim.wrong_outcomes[0].when = 'wrong_order'
    const out = checkWhenLegality([victim], d.minigames).join()
    expect(out).toMatch(/wrong_order/)
    expect(out).toMatch(/dial/)
  })

  it("fires on an instance mixing 'any' with a specific value", () => {
    const victim = structuredClone(d.instances.find((i: any) => i.minigame === 'queue_triage'))
    victim.wrong_outcomes[0].when = 'any'
    expect(checkWhenLegality([victim], d.minigames).join()).toMatch(/mixes 'any'/)
  })

  it('accepts a single specific entry, which four of five formats require', () => {
    const victim = structuredClone(d.instances.find((i: any) => i.minigame === 'log_triage'))
    expect(victim.wrong_outcomes).toHaveLength(1)
    expect(checkWhenLegality([victim], d.minigames)).toEqual([])
  })
})
