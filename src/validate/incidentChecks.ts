import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from './loadJson'
import { matchActions } from './matchActions'

const INCIDENT_DIR = 'data/incidents'
const EXPECTED_FAMILIES: Record<string, number> = {
  infrastructure: 10, capacity: 8, data: 8, queue: 6, security: 8, delivery: 4, business: 5,
}

export type Incident = any

export function loadIncidents(): Incident[] {
  const dir = resolve(import.meta.dirname, '../..', INCIDENT_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return files.flatMap((f) => loadJson<any>(`${INCIDENT_DIR}/${f}`).incidents)
}

export function checkIncidentCount(incidents: Incident[]): string[] {
  const problems: string[] = []
  if (incidents.length !== 49) problems.push(`expected 49 incidents, found ${incidents.length}`)
  const seen = new Set<string>()
  for (const i of incidents) {
    if (seen.has(i.id)) problems.push(`duplicate incident id '${i.id}'`)
    seen.add(i.id)
  }
  const byFamily: Record<string, number> = {}
  for (const i of incidents) byFamily[i.family] = (byFamily[i.family] ?? 0) + 1
  for (const [fam, n] of Object.entries(EXPECTED_FAMILIES)) {
    if ((byFamily[fam] ?? 0) !== n) {
      problems.push(`family '${fam}': expected ${n} incidents, found ${byFamily[fam] ?? 0}`)
    }
  }
  return problems
}

export function checkTagIncidentBidirectional(incidents: Incident[], tags: any[]): string[] {
  const problems: string[] = []
  const ids = new Set(incidents.map((i) => i.id))
  const named = new Set(tags.flatMap((t) => t.targeted_by ?? []))
  const runtimeOnly = new Set(tags.filter((t) => t.runtime_only).map((t) => t.id))

  for (const t of tags) {
    for (const inc of t.targeted_by ?? []) {
      if (!ids.has(inc)) problems.push(`tag '${t.id}': targeted_by names unknown incident '${inc}'`)
    }
  }
  for (const i of incidents) {
    // Architecture-scope incidents are found by posture condition, not by tag.
    if (i.scope === 'architecture') continue
    // An incident targeting a runtime-only tag is reachable only after a producer
    // incident creates that tag, so it is discovered transitively through the
    // producer rather than through the tag registry. Requiring a targeted_by entry
    // would force the registry to name it as a hunter of a tag it can only inherit.
    const targetTags = [
      ...(i.target?.tags_all ?? []),
      ...(i.target?.tags_any ?? []),
    ]
    if (targetTags.some((t: string) => runtimeOnly.has(t))) continue
    if (!named.has(i.id)) {
      problems.push(`incident '${i.id}': ${i.scope} scope but no tag names it in targeted_by`)
    }
  }
  return problems
}

function constraintProblems(c: any, where: string, catalog: any): string[] {
  if (!c) return []
  const out: string[] = []
  const tagIds = new Set(catalog.tags.map((t: any) => t.id))
  const layerIds = new Set(catalog.layers.map((l: any) => l.id))
  const nodeIds = new Set(catalog.nodes.map((n: any) => n.id))
  const roles = new Set(catalog.nodes.map((n: any) => n.role))
  for (const t of [...(c.tags_all ?? []), ...(c.tags_any ?? []), ...(c.tags_none ?? [])]) {
    if (!tagIds.has(t)) out.push(`${where}: unknown tag '${t}'`)
  }
  for (const l of c.layers ?? []) if (!layerIds.has(l)) out.push(`${where}: unknown layer '${l}'`)
  for (const n of c.node_ids ?? []) if (!nodeIds.has(n)) out.push(`${where}: unknown node id '${n}'`)
  for (const r of c.roles ?? []) if (!roles.has(r)) out.push(`${where}: unknown role '${r}'`)
  return out
}

export function checkIncidentConstraintRefs(incidents: Incident[], catalog: any): string[] {
  const problems: string[] = []
  for (const i of incidents) {
    problems.push(...constraintProblems(i.target, `incident '${i.id}' target`, catalog))
    if (i.fires_when) {
      problems.push(...constraintProblems(i.fires_when.any_node,
        `incident '${i.id}' fires_when.any_node`, catalog))
      problems.push(...constraintProblems(i.fires_when.no_node,
        `incident '${i.id}' fires_when.no_node`, catalog))
    }
    i.signals.forEach((s: any, n: number) => problems.push(
      ...constraintProblems(s.requires, `incident '${i.id}' signals[${n}].requires`, catalog)))
    for (const t of i.damage.tags_add ?? []) {
      if (!catalog.tags.some((x: any) => x.id === t)) {
        problems.push(`incident '${i.id}': damage.tags_add unknown tag '${t}'`)
      }
    }
  }
  return problems
}

function tierSatisfies(c: any, node: any, tier: any, runtimeOnly: string[]): boolean {
  if (!c) return false
  const tags = new Set([...tier.tags, ...runtimeOnly])
  if (c.layers && !c.layers.includes(node.layer)) return false
  if (c.roles && !c.roles.includes(node.role)) return false
  if (c.node_ids && !c.node_ids.includes(node.id)) return false
  if (c.tags_all && !c.tags_all.every((t: string) => tags.has(t))) return false
  if (c.tags_any && !c.tags_any.some((t: string) => tags.has(t))) return false
  if (c.tags_none && c.tags_none.some((t: string) => tier.tags.includes(t))) return false
  if (c.min_tier !== undefined && tier.tier < c.min_tier) return false
  if (c.max_tier !== undefined && tier.tier > c.max_tier) return false
  return true
}

export function checkResolvedByMatchable(incidents: Incident[], catalog: any): string[] {
  const problems: string[] = []
  const runtimeOnly = catalog.tags.filter((t: any) => t.runtime_only).map((t: any) => t.id)
  const actionIds = new Set(catalog.actions.map((a: any) => a.id))
  const tiers = catalog.nodes.flatMap((n: any) => n.tiers.map((t: any) => ({ node: n, tier: t })))

  for (const i of incidents) {
    for (const a of i.resolved_by) {
      if (!actionIds.has(a)) {
        problems.push(`incident '${i.id}': unknown action '${a}' in resolved_by`)
        continue
      }
    }
    if (i.scope === 'architecture') continue
    const targetable = tiers.filter(({ node, tier }: any) =>
      tierSatisfies(i.target, node, tier, runtimeOnly))
    if (targetable.length === 0) {
      problems.push(`incident '${i.id}': target matches no node tier — it can never fire`)
      continue
    }
    for (const a of i.resolved_by) {
      const ok = targetable.some(({ node, tier }: any) => matchActions({
        layer: node.layer, role: node.role, node_id: node.id, tier: tier.tier,
        health: 50, tags: [...tier.tags, ...runtimeOnly],
        actions_extra: tier.actions_extra, actions_deny: tier.actions_deny,
      }, catalog.actions).includes(a))
      if (!ok) {
        problems.push(`incident '${i.id}': resolving action '${a}' is not offered on any node it can target`)
      }
    }
  }
  return problems
}

export function checkEscalationGraph(incidents: Incident[]): string[] {
  const problems: string[] = []
  const ids = new Set(incidents.map((i) => i.id))
  const next = new Map<string, string>()
  for (const i of incidents) {
    if (!i.escalates_to) continue
    if (!ids.has(i.escalates_to)) {
      problems.push(`incident '${i.id}': escalates_to unknown incident '${i.escalates_to}'`)
      continue
    }
    if (i.escalate_after_ticks === null) {
      problems.push(`incident '${i.id}': escalates_to without escalate_after_ticks`)
    }
    next.set(i.id, i.escalates_to)
  }
  for (const start of next.keys()) {
    const seen = new Set<string>([start])
    let cur = next.get(start)
    while (cur) {
      if (seen.has(cur)) { problems.push(`escalation cycle involving '${cur}'`); break }
      seen.add(cur)
      cur = next.get(cur)
    }
  }
  return problems
}

export function checkWeaknessCoverage(incidents: Incident[], tags: any[], actions: any[]): string[] {
  // For each weakness, derive the capability tags that clearing it grants.
  // chain: weakness.resolved_by → action.on_success.tags_add
  const pairedCaps = new Map<string, Set<string>>()
  for (const t of tags) {
    if (t.kind !== 'weakness') continue
    const caps = new Set<string>()
    for (const aId of t.resolved_by ?? []) {
      const action = actions.find((a: any) => a.id === aId)
      for (const cap of action?.on_success?.tags_add ?? []) caps.add(cap)
    }
    pairedCaps.set(t.id, caps)
  }

  // Direct: all tags referenced in any incident constraint (tags_all / tags_any / tags_none).
  // Paired-cap: capability tags that appear specifically in tags_none (targeting nodes that
  //   lack the capability is equivalent to targeting nodes that carry the weakness).
  const hunted = new Set<string>()
  const inTagsNone = new Set<string>()
  const collect = (c: any) => {
    if (!c) return
    for (const t of [...(c.tags_all ?? []), ...(c.tags_any ?? []), ...(c.tags_none ?? [])]) hunted.add(t)
    for (const t of c.tags_none ?? []) inTagsNone.add(t)
  }
  for (const i of incidents) {
    collect(i.target)
    if (i.fires_when) { collect(i.fires_when.any_node); collect(i.fires_when.no_node) }
  }

  return tags
    .filter((t) => {
      if (t.kind !== 'weakness') return false
      if (hunted.has(t.id)) return false  // weakness tag referenced directly
      const caps = pairedCaps.get(t.id) ?? new Set()
      if ([...caps].some((c) => inTagsNone.has(c))) return false  // paired capability in tags_none
      return true
    })
    .map((t) => {
      const caps = [...(pairedCaps.get(t.id) ?? [])]
      const hint = caps.length
        ? ` (neither the tag nor its paired capabilities [${caps.join(', ')}] appear in any incident constraint)`
        : ''
      return `weakness tag '${t.id}' is targeted by no incident, positively or by absence${hint}`
    })
}
