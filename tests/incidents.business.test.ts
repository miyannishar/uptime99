import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/business.json')
const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]))

describe('data/incidents/business.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/business.json')
  })

  it('defines the five business incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'compliance_audit_failure', 'data_subject_access_request',
      'gdpr_breach_notification', 'pci_audit_failure', 'sla_breach',
    ])
  })

  it('makes every business incident architecture-scope with no node target', () => {
    for (const i of incidents) {
      expect(i.scope, i.id).toBe('architecture')
      expect(i.target, i.id).toBeNull()
      expect(i.group_by, i.id).toBeNull()
      expect(i.fires_when, i.id).toBeTruthy()
      expect(i.weight_per_target, i.id).toBe(0)
    }
  })

  it('fires the PCI audit on unencrypted data nodes', () => {
    const c = byId.pci_audit_failure.fires_when.any_node
    expect(c.layers).toContain('data')
    expect(c.tags_none).toContain('encrypted_at_rest')
  })

  it('references no deleted posture tag', () => {
    const blob = JSON.stringify(incidents)
    expect(blob).not.toContain('pci_scope')
    expect(blob).not.toContain('gdpr_scope')
  })

  it('makes the GDPR fine the most expensive event in the catalog', () => {
    const basis = byId.gdpr_breach_notification.ledger_events[0].basis
    expect(basis).toContain('300')
    expect(byId.gdpr_breach_notification.severity).toBe(5)
  })

  it('gives every incident a level-0 signal', () => {
    for (const i of incidents) {
      expect(i.signals.find((s: any) => s.level === 0), i.id).toBeTruthy()
    }
  })
})
