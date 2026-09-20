import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const doc = readFileSync(resolve(import.meta.dirname, '../CLAUDE.md'), 'utf8')

describe('CLAUDE.md', () => {
  it('states the two-layer rule', () => {
    expect(doc).toMatch(/never mutated at runtime/i)
  })

  it('points at the commands that verify a change', () => {
    expect(doc).toContain('npm test')
    expect(doc).toContain('npm run validate')
  })

  it('links the spec', () => {
    expect(doc).toContain('docs/superpowers/specs/2026-09-17-node-taxonomy-data-model-design.md')
  })

  it('documents every data file', () => {
    for (const f of ['data/tags.json', 'data/layers.json', 'data/actions.json',
                     'data/metrics.json', 'data/nodes/', 'data/schema/']) {
      expect(doc, f).toContain(f)
    }
  })

  it('documents the incident model', () => {
    expect(doc).toContain('data/incidents/')
    expect(doc).toMatch(/50 incidents/)
    expect(doc).toMatch(/48 tags/)
  })

  it('states the runtime-tag production rule', () => {
    expect(doc).toMatch(/cold_cache/)
    expect(doc).toMatch(/unbounded_queue/)
    expect(doc).toMatch(/damage\.tags_add/)
    expect(doc).toMatch(/runtime_only/i)
  })

  it('defines incident_severity', () => {
    expect(doc).toMatch(/incident_severity/)
  })

  it('documents the signal levels', () => {
    expect(doc).toMatch(/level 0/i)
    expect(doc).toMatch(/tracing/)
  })

  it('documents the minigame model', () => {
    expect(doc).toContain('data/minigames/')
    expect(doc).toMatch(/five (interaction )?formats|5 (interaction )?formats/i)
    expect(doc).toMatch(/difficulty-slot/i)
  })

  it('states the format-agnostic split', () => {
    expect(doc).toMatch(/teaches/)
    expect(doc).toMatch(/reveal/)
    expect(doc).toMatch(/given/)
    expect(doc).toMatch(/solution/)
  })

  it('links the minigame spec', () => {
    expect(doc).toContain('docs/superpowers/specs/2026-09-18-minigame-data-model-design.md')
  })

  it('documents the engine layer', () => {
    expect(doc).toContain('src/engine/')
    expect(doc).toMatch(/two-layer rule/i)
    expect(doc).toMatch(/deepFreeze|frozen/)
  })

  it('states the formula evaluator rules', () => {
    expect(doc).toMatch(/saturation_curve/)
    expect(doc).toMatch(/eval/)
    expect(doc).toMatch(/allowlist/i)
  })

  it('links the engine spec', () => {
    expect(doc).toContain('docs/superpowers/specs/2026-09-19-engine-core-design.md')
  })

  it('documents the level difficulty curve', () => {
    expect(doc).toContain('data/levels.json')
    expect(doc).toMatch(/severity_max/)
    expect(doc).toMatch(/arrival_mean_ticks/)
  })

  it('documents the tick loop order', () => {
    expect(doc).toMatch(/per-tick order|tick order/i)
    expect(doc).toMatch(/dtTicks/)
  })

  it('documents that arrival damage applies once', () => {
    expect(doc).toMatch(/once, not every tick|one-off shock/i)
  })
})
