import { describe, it, expect } from 'vitest'
import { buildSeedContext, resolveText } from '../src/engine/template'

describe('buildSeedContext', () => {
  it('is stable for the same key and varies across keys', () => {
    expect(buildSeedContext('incident:a')).toEqual(buildSeedContext('incident:a'))
    const ids = new Set(Array.from({ length: 50 }, (_, i) => buildSeedContext(`k${i}`).entity_id))
    expect(ids.size).toBeGreaterThan(40)
  })

  it('stays inside the documented ranges and vocabularies', () => {
    for (let i = 0; i < 200; i++) {
      const c = buildSeedContext(`key-${i}`)
      expect(c.entity_id).toBeGreaterThanOrEqual(100); expect(c.entity_id).toBeLessThanOrEqual(9999)
      expect(c.revision).toBeGreaterThanOrEqual(10); expect(c.revision).toBeLessThanOrEqual(89)
      expect(c.pid).toBeGreaterThanOrEqual(1000); expect(c.pid).toBeLessThanOrEqual(60999)
      expect(c.ip_octet).toBeGreaterThanOrEqual(10); expect(c.ip_octet).toBeLessThanOrEqual(249)
      expect(c.db_index).toBeGreaterThanOrEqual(1); expect(c.db_index).toBeLessThanOrEqual(14)
      expect(['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark', 'wayne', 'soylent']).toContain(c.tenant)
      expect(['user', 'session', 'cart', 'product']).toContain(c.key_prefix)
      expect(['us-east-1', 'eu-west-1', 'ap-south-1', 'us-west-2']).toContain(c.region)
      expect(c.deploy_version).toMatch(/^v\d+\.\d+\.\d+$/)
    }
  })

  it('resolves inside templates, including arithmetic', () => {
    const c = buildSeedContext('ticket:add_backup')
    expect(resolveText('{{key_prefix}}:{{entity_id}}:*', c)).toBe(`${c.key_prefix}:${c.entity_id}:*`)
    expect(resolveText('--to-revision={{revision - 1}}', c)).toBe(`--to-revision=${c.revision - 1}`)
  })
})
