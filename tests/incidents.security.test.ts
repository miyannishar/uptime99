import { describe, it, expect } from 'vitest'
import { expectValidIncidentFile } from './helpers/dataFiles'
import { loadJson } from '../src/validate/loadJson'

const { incidents } = loadJson<any>('data/incidents/security.json')
const byId = Object.fromEntries(incidents.map((i: any) => [i.id, i]))

describe('data/incidents/security.json', () => {
  it('is a valid incident file', () => {
    expectValidIncidentFile('data/incidents/security.json')
  })

  it('defines the eight security incidents', () => {
    expect(incidents.map((i: any) => i.id).sort()).toEqual([
      'brute_force_attack', 'cert_expiry_incident', 'credential_leak',
      'credential_stuffing', 'data_breach', 'insider_threat',
      'ransomware_attack', 'tls_handshake_error',
    ])
  })

  it('tests posture by absence rather than by a posture tag', () => {
    expect(byId.insider_threat.fires_when.any_node.tags_none).toContain('audit_logged')
    expect(byId.credential_stuffing.target.tags_none).toContain('rate_limited')
    expect(byId.brute_force_attack.target.tags_none).toContain('rate_limited')
  })

  it('fires ransomware only when nothing is backed up', () => {
    expect(byId.ransomware_attack.fires_when.no_node.tags_all).toContain('backed_up')
    expect(byId.ransomware_attack.scope).toBe('architecture')
  })

  it('references no deleted posture tag', () => {
    const blob = JSON.stringify(incidents)
    expect(blob).not.toContain('pci_scope')
    expect(blob).not.toContain('gdpr_scope')
  })

  it('escalates credential leak into breach into notification', () => {
    expect(byId.credential_leak.escalates_to).toBe('data_breach')
    expect(byId.data_breach.escalates_to).toBe('gdpr_breach_notification')
  })

  it('rates the two catastrophes at severity 5', () => {
    expect(byId.data_breach.severity).toBe(5)
    expect(byId.ransomware_attack.severity).toBe(5)
  })

  it('gives every incident a level-0 signal', () => {
    for (const i of incidents) {
      expect(i.signals.find((s: any) => s.level === 0), i.id).toBeTruthy()
    }
  })
})
