import { describe, it, expect } from 'vitest'
import { loadEngineCatalog } from '../src/engine/catalog'
import { loadScenario } from '../src/engine/scenario'
import { priceLedgerEvent, ledgerEntriesFor } from '../src/engine/ledger'

const c = loadEngineCatalog()
const base = loadScenario('slice-oom-kill', c)

describe('priceLedgerEvent', () => {
  it('evaluates a severity-based basis', () => {
    const inc = c.incidentById.get('oom_kill')!   // severity 3, basis 'severity * 20'
    const ev = inc.ledger_events.find((e: any) => e.basis.includes('severity'))!
    expect(priceLedgerEvent(ev, inc, {
      economy: c.economy, affected_instances: 1, affected_users: 50000,
    })).toBe(60)
  })

  it('evaluates an affected_users basis using credit_rate from economy', () => {
    const ev = { kind: 'sla_credit', when: 'on_resolve', basis: 'affected_users * credit_rate' }
    const inc = c.incidentById.get('oom_kill')!
    expect(priceLedgerEvent(ev as any, inc, {
      economy: c.economy, affected_instances: 1, affected_users: 1000,
    })).toBe(250)   // 1000 * 0.25
  })

  it('evaluates an affected_instances basis', () => {
    const ev = { kind: 'overage', when: 'per_tick', basis: 'affected_instances * 4' }
    const inc = c.incidentById.get('oom_kill')!
    expect(priceLedgerEvent(ev as any, inc, {
      economy: c.economy, affected_instances: 3, affected_users: 0,
    })).toBe(12)
  })

  it('throws on an unknown identifier rather than pricing as zero', () => {
    const ev = { kind: 'overage', when: 'per_tick', basis: 'mystery * 2' }
    const inc = c.incidentById.get('oom_kill')!
    expect(() => priceLedgerEvent(ev as any, inc, {
      economy: c.economy, affected_instances: 1, affected_users: 0,
    })).toThrow(/mystery/)
  })

  it('prices every basis in the shipped catalogue without throwing', () => {
    for (const inc of c.incidents) {
      for (const ev of inc.ledger_events) {
        expect(() => priceLedgerEvent(ev, inc, {
          economy: c.economy, affected_instances: 2, affected_users: 50000,
        })).not.toThrow()
      }
    }
  })
})

describe('ledgerEntriesFor', () => {
  it('returns only the events matching the requested `when`', () => {
    const inc = c.incidents.find((i: any) =>
      i.ledger_events.some((e: any) => e.when === 'per_tick'))!
    const out = ledgerEntriesFor(inc, 'per_tick', base, c, ['app-cluster-1'])
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((e) => e.kind.length > 0)).toBe(true)
  })

  it('returns an empty list when no event matches', () => {
    const inc = c.incidentById.get('oom_kill')!
    expect(ledgerEntriesFor(inc, 'on_trigger', base, c, [])).toEqual([])
  })

  it('records charges as negative amounts', () => {
    const inc = c.incidents.find((i: any) =>
      i.ledger_events.some((e: any) => e.when === 'on_resolve'))!
    const out = ledgerEntriesFor(inc, 'on_resolve', base, c, ['app-cluster-1'])
    expect(out.every((e) => e.amount <= 0)).toBe(true)
  })

  it('marks every entry once, because a per_tick charge is not a standing monthly rate', () => {
    // per_tick means "append a fresh charge on each tick the incident is active" —
    // each appended entry is a discrete one-off, not a standing monthly line item.
    // 'monthly' is reserved for standing charges that will exist in a later cycle.
    for (const inc of c.incidents) {
      for (const when of ['per_tick', 'on_resolve', 'on_expire'] as const) {
        for (const e of ledgerEntriesFor(inc, when, base, c, ['app-cluster-1'])) {
          expect(e.cadence).toBe('once')
        }
      }
    }
  })

  it('stamps the entry with the current tick and keeps the basis', () => {
    const inc = c.incidentById.get('oom_kill')!
    const at = { ...base, tick: 37 }
    const out = ledgerEntriesFor(inc, 'on_resolve', at, c, ['app-cluster-1'])
    expect(out[0].tick).toBe(37)
    expect(typeof out[0].basis).toBe('number')
  })
})
