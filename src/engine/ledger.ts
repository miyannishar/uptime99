import { evaluateFormula, type FormulaScope } from './formula'
import type { EngineCatalog } from './catalog'
import type { GameState, LedgerEntry } from './types'

export interface PriceContext {
  readonly economy: Readonly<Record<string, any>>
  readonly affected_instances: number
  readonly affected_users: number
}

/**
 * A ledger event's `basis` is an expression, not a number — all 28 forms in the
 * catalogue use severity, affected_instances, affected_users, credit_rate or
 * emergency_premium_multiplier. Routing it through evaluateFormula means the
 * six-function allowlist and the throw-on-unknown-identifier guard cover pricing
 * too: a typo'd basis fails loudly instead of quietly costing nothing.
 */
export function priceLedgerEvent(event: any, incident: any, ctx: PriceContext): number {
  const scope: FormulaScope = {
    scalars: {
      ...Object.fromEntries(
        Object.entries(ctx.economy).filter(([, v]) => typeof v === 'number') as [string, number][]),
      severity: incident.severity,
      affected_instances: ctx.affected_instances,
      affected_users: ctx.affected_users,
    },
    vectors: {},
  }
  return evaluateFormula(event.basis, scope)
}

/**
 * The priced entries an incident emits at one timing point. Amounts are negative
 * because every kind in the catalogue is a charge. Every entry is a discrete
 * one-off: `per_tick` means "append a fresh charge each tick the incident is
 * active", not "this is a standing monthly line item". `monthly` cadence is
 * reserved for standing charges appended once and persisting (e.g. a provisioned
 * node's recurring cost) — nothing emits one yet.
 */
export function ledgerEntriesFor(
  incident: any,
  when: 'on_trigger' | 'per_tick' | 'on_resolve' | 'on_expire',
  state: GameState,
  catalog: EngineCatalog,
  affectedIds: readonly string[],
): LedgerEntry[] {
  const ctx: PriceContext = {
    economy: catalog.economy,
    affected_instances: affectedIds.length,
    affected_users: state.carried.users,
  }
  return (incident.ledger_events ?? [])
    .filter((e: any) => e.when === when)
    .map((e: any) => {
      const magnitude = priceLedgerEvent(e, incident, ctx)
      return {
        kind: e.kind,
        basis: magnitude,
        // `per_tick` means a fresh one-off charge on each tick the incident is
        // active, not a standing monthly line item — so every entry is 'once'.
        // 'monthly' is reserved for a standing charge appended once and persisting;
        // nothing emits one yet. Marking per_tick entries 'monthly' made
        // cost_month sum the same charge once per elapsed tick.
        cadence: 'once',
        amount: -Math.abs(magnitude),
        tick: state.tick,
        instance_id: affectedIds.length === 1 ? affectedIds[0] : null,
      } satisfies LedgerEntry
    })
}
