import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { compileSchema } from '../src/validate/schemaValidator'
import { loadJson } from '../src/validate/loadJson'
import { expectValidIncidentFile } from './helpers/dataFiles'

// Helpers for inline fixture tests
function withTmpFixture(data: unknown, fn: (p: string) => void): void {
  const p = path.join(os.tmpdir(), `inc-test-${Date.now()}.json`)
  fs.writeFileSync(p, JSON.stringify(data))
  try { fn(p) } finally { fs.unlinkSync(p) }
}

function makeInc(overrides: Record<string, unknown>) {
  return {
    incidents: [{
      id: 'test_incident',
      name: 'Test incident',
      family: 'capacity',
      severity: 2,
      scope: 'instance',
      group_by: null,
      fires_when: null,
      gates: { min_tick: 0, min_users: 0, cooldown_ticks: 10 },
      base_weight: 1,
      weight_per_target: 1,
      damage: { health_delta: -10 },
      duration_ticks: null,
      escalates_to: null,
      escalate_after_ticks: null,
      ledger_events: [],
      signals: [{ level: 0, requires: null, text: 'The service is responding slowly.' }],
      ...overrides,
    }],
  }
}

const validate = compileSchema('data/schema/incident.schema.json')
const base = loadJson<any>('tests/fixtures/valid-incident-file.json')
const clone = () => structuredClone(base)

describe('incident.schema.json', () => {
  it('accepts a well-formed incident file', () => {
    expect(validate(base).errors.join('\n')).toBe('')
  })

  it('rejects an unknown scope', () => {
    const bad = clone(); bad.incidents[0].scope = 'galaxy'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects severity outside 1..5', () => {
    const bad = clone(); bad.incidents[0].severity = 6
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown ledger event kind', () => {
    const bad = clone(); bad.incidents[0].ledger_events[0].kind = 'vibes_tax'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown ledger when value', () => {
    const bad = clone(); bad.incidents[0].ledger_events[0].when = 'eventually'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown group_by dimension', () => {
    const bad = clone(); bad.incidents[0].group_by = 'rack'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown family', () => {
    const bad = clone(); bad.incidents[0].family = 'misc'
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an unknown constraint field in target', () => {
    const bad = clone(); bad.incidents[0].target.tags_maybe = ['spof']
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a signal with no text', () => {
    const bad = clone(); delete bad.incidents[0].signals[0].text
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects an incident with no signals', () => {
    const bad = clone(); bad.incidents[0].signals = []
    expect(validate(bad).valid).toBe(false)
  })

  it('rejects a runtime field on a definition', () => {
    const bad = clone(); bad.incidents[0].ticks_active = 4
    expect(validate(bad).valid).toBe(false)
  })
})

describe('expectValidIncidentFile', () => {
  it('accepts the valid fixture', () => {
    expect(() => expectValidIncidentFile('tests/fixtures/valid-incident-file.json')).not.toThrow()
  })

  it('rejects an unresolvable incident with no duration', () => {
    expect(() => expectValidIncidentFile('tests/fixtures/invalid-incident-file.json'))
      .toThrow(/duration_ticks/)
  })

  // Regression: tags_none in target must be evaluated against real tags only.
  // Injecting runtime-only tags before evaluating tags_none would incorrectly
  // exclude tiers that don't actually carry the excluded tag, producing a false positive.
  it('accepts target combining tags_all and tags_none with a valid resolving action', () => {
    // scale_out requires tags_all: ["horizontally_scalable"]; several compute tiers have it.
    // cold_cache is runtime_only and appears on none of those tiers in their definitions.
    // This must not throw.
    withTmpFixture(
      makeInc({
        target: { tags_all: ['horizontally_scalable'], tags_none: ['cold_cache'] },
        resolved_by: ['scale_out'],
      }),
      (p) => expect(() => expectValidIncidentFile(p)).not.toThrow(),
    )
  })

  // Regression: matchability check must still fire — a mismatch between the
  // incident's target and what the resolving action can reach must be caught.
  it('rejects an incident whose resolved_by action cannot reach its target nodes', () => {
    // add_replica requires layers:["data"] + tags_all:["stateful"].
    // stale_cert lives only on tls_cert (edge layer) — no targetable tier offers add_replica.
    withTmpFixture(
      makeInc({
        target: { tags_all: ['stale_cert'] },
        resolved_by: ['add_replica'],
        duration_ticks: 20, // avoid the empty-resolved_by/no-duration error
      }),
      (p) =>
        expect(() => expectValidIncidentFile(p)).toThrow(
          /action 'add_replica' in resolved_by is not matchable/,
        ),
    )
  })
})
