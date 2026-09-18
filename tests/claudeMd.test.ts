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
})
