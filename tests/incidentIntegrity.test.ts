import { describe, it, expect } from 'vitest'
import { runIntegrityChecks } from '../src/validate/integrity'
import {
  loadIncidents, checkIncidentCount, checkTagIncidentBidirectional,
  checkIncidentConstraintRefs, checkResolvedByMatchable,
  checkEscalationGraph, checkWeaknessCoverage,
} from '../src/validate/incidentChecks'
import { loadCatalog } from '../src/validate/integrity'
import { loadJson } from '../src/validate/loadJson'

const incidents = loadIncidents()
const catalog = loadCatalog()
const tags = loadJson<any>('data/tags.json').tags

describe('the shipped incident data', () => {
  it('reports no integrity problems at all', () => {
    expect(runIntegrityChecks()).toEqual([])
  })

  it('loads exactly 49 incidents with unique ids', () => {
    expect(incidents).toHaveLength(49)
    expect(new Set(incidents.map((i) => i.id)).size).toBe(49)
  })

  it('splits them across the seven families as specified', () => {
    const byFamily: Record<string, number> = {}
    for (const i of incidents) byFamily[i.family] = (byFamily[i.family] ?? 0) + 1
    expect(byFamily).toEqual({
      infrastructure: 10, capacity: 8, data: 8, queue: 6,
      security: 8, delivery: 4, business: 5,
    })
  })
})

describe('checkIncidentCount', () => {
  it('fires when the count is wrong', () => {
    expect(checkIncidentCount(incidents.slice(1)).length).toBeGreaterThan(0)
  })
  it('passes on the real set', () => {
    expect(checkIncidentCount(incidents)).toEqual([])
  })
})

describe('checkTagIncidentBidirectional', () => {
  it('passes on the real data', () => {
    expect(checkTagIncidentBidirectional(incidents, tags)).toEqual([])
  })
  it('fires when a tag names an incident that does not exist', () => {
    const bogus = structuredClone(tags)
    bogus[0].targeted_by = [...bogus[0].targeted_by, 'volcano_eruption']
    expect(checkTagIncidentBidirectional(incidents, bogus).join()).toMatch(/volcano_eruption/)
  })
  it('fires when a non-architecture incident is named by no tag', () => {
    const orphan = structuredClone(incidents)
    const inst = orphan.find((i: any) =>
      i.scope === 'instance' &&
      ![...(i.target?.tags_all ?? []), ...(i.target?.tags_any ?? [])]
        .some((t: string) => ['cold_cache', 'unbounded_queue'].includes(t)))!
    inst.id = 'ghost_incident'
    expect(checkTagIncidentBidirectional(orphan, tags).join()).toMatch(/ghost_incident/)
  })

  it('exempts incidents that target a runtime-only tag', () => {
    // consumer_lag_spike and queue_overflow target tags_all: ["unbounded_queue"],
    // which no tag's targeted_by names them as hunters of — by design, since they
    // are reachable only after consumer_crash or scheduler_drift produces that tag.
    const problems = checkTagIncidentBidirectional(incidents, tags).join()
    expect(problems).not.toMatch(/consumer_lag_spike/)
    expect(problems).not.toMatch(/queue_overflow/)
  })
})

describe('checkIncidentConstraintRefs', () => {
  it('passes on the real data', () => {
    expect(checkIncidentConstraintRefs(incidents, catalog)).toEqual([])
  })
  it('fires on an unknown tag in a target', () => {
    const bad = structuredClone(incidents)
    const inst = bad.find((i: any) => i.target)!
    inst.target.tags_all = ['not_a_real_tag']
    expect(checkIncidentConstraintRefs(bad, catalog).join()).toMatch(/not_a_real_tag/)
  })
})

describe('checkResolvedByMatchable', () => {
  it('passes on the real data', () => {
    expect(checkResolvedByMatchable(incidents, catalog)).toEqual([])
  })
  it('fires when a resolving action can never be offered on a targetable node', () => {
    const bad = structuredClone(incidents)
    const i = bad.find((x: any) => x.id === 'cert_expiry_incident')!
    i.resolved_by = ['add_replica']
    expect(checkResolvedByMatchable(bad, catalog).join()).toMatch(/add_replica/)
  })
})

describe('checkEscalationGraph', () => {
  it('passes on the real data', () => {
    expect(checkEscalationGraph(incidents)).toEqual([])
  })
  it('fires on a dangling escalation target', () => {
    const bad = structuredClone(incidents)
    bad[0].escalates_to = 'nowhere_incident'
    bad[0].escalate_after_ticks = 10
    expect(checkEscalationGraph(bad).join()).toMatch(/nowhere_incident/)
  })
  it('fires on a cycle', () => {
    const bad = structuredClone(incidents)
    const a = bad.find((i: any) => i.id === 'consumer_crash')!
    const b = bad.find((i: any) => i.id === 'dlq_overflow')!
    b.escalates_to = 'consumer_crash'
    b.escalate_after_ticks = 10
    expect(checkEscalationGraph(bad).join()).toMatch(/cycle/i)
    expect(a.id).toBe('consumer_crash')
  })
})

describe('checkWeaknessCoverage', () => {
  it('passes — every weakness tag is hunted positively or by absence', () => {
    expect(checkWeaknessCoverage(incidents, tags, catalog.actions)).toEqual([])
  })

  it('treats tags_none of a paired capability as coverage for the weakness', () => {
    // no_autoscale is resolved by enable_autoscaling, which grants "autoscaling".
    // load_surge carries tags_none: ["autoscaling"] on the compute layer, so the
    // weakness is covered even though "no_autoscale" never appears in tags_all/tags_any.
    const problems = checkWeaknessCoverage(incidents, tags, catalog.actions).join()
    expect(problems).not.toMatch(/no_autoscale/)
  })

  it('fires when neither tag nor paired capability appears anywhere', () => {
    // A synthetic weakness whose resolution grants a capability that no incident
    // mentions — neither directly nor via tags_none.
    const fakeTags = structuredClone(tags)
    fakeTags.push({ id: 'phantom_weakness', kind: 'weakness', resolved_by: ['fix_phantom'], targeted_by: [] })
    const fakeActions: any[] = structuredClone(catalog.actions)
    fakeActions.push({ id: 'fix_phantom', on_success: { tags_add: ['phantom_capability'] } })
    const problems = checkWeaknessCoverage(incidents, fakeTags, fakeActions)
    expect(problems.join()).toMatch(/phantom_weakness/)
  })
})
