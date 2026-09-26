import { expect } from 'vitest'
import { compileSchema } from '../../src/validate/schemaValidator'
import { loadJson } from '../../src/validate/loadJson'
import { loadCatalog } from '../../src/validate/integrity'
import { matchActions } from '../../src/validate/matchActions'

const PERMITTED_BASIS_VARS = ['severity', 'affected_instances', 'affected_users', 'ticks_active']
const ALLOWED_FNS = ['sum', 'min', 'max', 'clamp']

export function expectValidAgainst(schemaPath: string, dataPath: string): void {
  const validate = compileSchema(schemaPath)
  const result = validate(loadJson(dataPath))
  expect(result.errors.join('\n')).toBe('')
  expect(result.valid).toBe(true)
}

export function allTagIds(): Set<string> {
  const { tags } = loadJson<{ tags: { id: string }[] }>('data/tags.json')
  return new Set(tags.map((t) => t.id))
}

export function expectValidNodeFile(dataPath: string): void {
  expectValidAgainst('data/schema/node.schema.json', dataPath)

  const { tags: tagDefs } = loadJson<{ tags: { id: string; runtime_only?: boolean }[] }>('data/tags.json')
  const known = new Set(tagDefs.map((t) => t.id))
  const runtimeOnly = new Set(tagDefs.filter((t) => t.runtime_only).map((t) => t.id))
  const { nodes } = loadJson<any>(dataPath)

  for (const node of nodes) {
    if (node.singleton && node.max_instances !== 1) {
      throw new Error(`${node.id}: singleton nodes must have max_instances 1`)
    }
    const tiers = node.tiers
    tiers.forEach((t: any, i: number) => {
      if (t.tier !== i + 1) throw new Error(`${node.id}: tier numbers must be contiguous from 1`)
      if (i > 0 && t.stats.cost_month <= tiers[i - 1].stats.cost_month) {
        throw new Error(`${node.id} tier ${t.tier}: cost_month must strictly increase`)
      }
      for (const tag of t.tags) {
        if (!known.has(tag)) throw new Error(`${node.id} tier ${t.tier}: unknown tag '${tag}'`)
        if (runtimeOnly.has(tag)) {
          throw new Error(`${node.id} tier ${t.tier}: '${tag}' is runtime_only and cannot appear in a definition`)
        }
      }
    })
  }
}

export function expectValidIncidentFile(dataPath: string): void {
  expectValidAgainst('data/schema/incident.schema.json', dataPath)

  const { incidents } = loadJson<any>(dataPath)
  const catalog = loadCatalog()
  const tagIds = new Set(catalog.tags.map((t: any) => t.id))
  const layerIds = new Set(catalog.layers.map((l: any) => l.id))
  const nodeIds = new Set(catalog.nodes.map((n: any) => n.id))
  const roles = new Set(catalog.nodes.map((n: any) => n.role))
  const actionIds = new Set(catalog.actions.map((a: any) => a.id))
  const economy = loadJson<any>('data/metrics.json').economy
  const economyNames = Object.keys(economy)

  const checkConstraint = (c: any, where: string) => {
    if (!c) return
    for (const t of [...(c.tags_all ?? []), ...(c.tags_any ?? []), ...(c.tags_none ?? [])]) {
      if (!tagIds.has(t)) throw new Error(`${where}: unknown tag '${t}'`)
    }
    for (const l of c.layers ?? []) if (!layerIds.has(l)) throw new Error(`${where}: unknown layer '${l}'`)
    for (const n of c.node_ids ?? []) if (!nodeIds.has(n)) throw new Error(`${where}: unknown node id '${n}'`)
    for (const r of c.roles ?? []) if (!roles.has(r)) throw new Error(`${where}: unknown role '${r}'`)
  }

  // runtime-only tags are treated as satisfiable for matchability checks
  const runtimeOnly = catalog.tags.filter((t: any) => t.runtime_only).map((t: any) => t.id)
  const allTiers = () =>
    catalog.nodes.flatMap((n: any) => n.tiers.map((t: any) => ({ node: n, tier: t })))

  for (const inc of incidents) {
    const at = `incident '${inc.id}'`
    checkConstraint(inc.target, `${at} target`)
    if (inc.fires_when) {
      checkConstraint(inc.fires_when.any_node, `${at} fires_when.any_node`)
      checkConstraint(inc.fires_when.no_node, `${at} fires_when.no_node`)
    }
    inc.signals.forEach((s: any, i: number) =>
      checkConstraint(s.requires, `${at} signals[${i}].requires`))

    // scope coherence
    if (inc.scope === 'architecture') {
      if (inc.target !== null) throw new Error(`${at}: architecture scope requires target null`)
      if (!inc.fires_when) throw new Error(`${at}: architecture scope requires fires_when`)
      if (inc.group_by !== null) throw new Error(`${at}: architecture scope requires group_by null`)
    } else {
      if (inc.target === null) throw new Error(`${at}: ${inc.scope} scope requires a target`)
      if (inc.fires_when !== null) throw new Error(`${at}: ${inc.scope} scope requires fires_when null`)
    }
    if (inc.scope === 'group' && !inc.group_by) throw new Error(`${at}: group scope requires group_by`)
    if (inc.scope === 'instance' && inc.group_by !== null) {
      throw new Error(`${at}: instance scope requires group_by null`)
    }

    // resolution
    if (inc.resolved_by.length === 0 && inc.duration_ticks === null) {
      throw new Error(`${at}: empty resolved_by requires duration_ticks — nothing would end it`)
    }
    for (const a of inc.resolved_by) {
      if (!actionIds.has(a)) throw new Error(`${at}: unknown action '${a}' in resolved_by`)
    }
    // matchability: at least one targetable tier offers each resolving action.
    // "Targetable" means the tier satisfies the incident's target constraint.
    // Runtime-only tags are injected so mid-incident actions (e.g. warm_cache) are reachable.
    //
    // tierSatisfies evaluates the target constraint directly with asymmetric runtime-tag handling:
    //   tags_all / tags_any  — evaluated against tier.tags PLUS runtimeOnly (incident may target
    //                          a node that will acquire a runtime tag during the incident)
    //   tags_none            — evaluated against tier.tags ONLY (injecting a runtime-only tag
    //                          would mean no tier could ever satisfy an exclusion of it)
    //   min_health/max_health — ignored (runtime conditions; irrelevant for definition-time check)
    const tierSatisfies = (c: any, node: any, tier: any): boolean => {
      if (!c) return true
      if (c.layers && !c.layers.includes(node.layer)) return false
      if (c.roles && !c.roles.includes(node.role)) return false
      if (c.node_ids && !c.node_ids.includes(node.id)) return false
      if (c.min_tier !== undefined && tier.tier < c.min_tier) return false
      if (c.max_tier !== undefined && tier.tier > c.max_tier) return false
      const tagsWithRuntime = new Set([...tier.tags, ...runtimeOnly])
      if (c.tags_all && !c.tags_all.every((t: string) => tagsWithRuntime.has(t))) return false
      if (c.tags_any && !c.tags_any.some((t: string) => tagsWithRuntime.has(t))) return false
      const realTags = new Set(tier.tags as string[])
      if (c.tags_none && c.tags_none.some((t: string) => realTags.has(t))) return false
      return true
    }

    if (inc.scope !== 'architecture') {
      for (const a of inc.resolved_by) {
        const ok = allTiers().some(({ node, tier }: any) => {
          if (!tierSatisfies(inc.target, node, tier)) return false
          const offered = matchActions(
            {
              layer: node.layer,
              role: node.role,
              node_id: node.id,
              tier: tier.tier as number,
              health: 50,
              tags: [...tier.tags, ...runtimeOnly],
              actions_extra: tier.actions_extra as string[] | undefined,
              actions_deny: tier.actions_deny as string[] | undefined,
            },
            catalog.actions,
          )
          return offered.includes(a)
        })
        if (!ok)
          throw new Error(`${at}: action '${a}' in resolved_by is not matchable on any targetable node tier`)
      }
    }

    // escalation shape (cross-file resolution happens in the whole-set validator)
    if (inc.escalates_to && inc.escalate_after_ticks === null) {
      throw new Error(`${at}: escalates_to requires escalate_after_ticks`)
    }
    if (!inc.escalates_to && inc.escalate_after_ticks !== null) {
      throw new Error(`${at}: escalate_after_ticks without escalates_to`)
    }

    // damage tags must exist
    for (const t of inc.damage.tags_add ?? []) {
      if (!tagIds.has(t)) throw new Error(`${at}: damage.tags_add unknown tag '${t}'`)
    }

    // signals: level-0 with requires null is mandatory
    const l0 = inc.signals.find((s: any) => s.level === 0)
    if (!l0 || l0.requires !== null)
      throw new Error(`${at}: needs a level-0 signal with requires null`)
    const levels = inc.signals.map((s: any) => s.level)
    if (new Set(levels).size !== levels.length) throw new Error(`${at}: duplicate signal levels`)
    if (levels.join() !== [...levels].sort((a: number, b: number) => a - b).join()) {
      throw new Error(`${at}: signal levels must ascend`)
    }

    // basis expressions: only permitted variables, economy constants, and allowlisted functions
    for (const ev of inc.ledger_events) {
      const idents = [...ev.basis.matchAll(/[a-z_][a-z0-9_]*/g)].map((m: RegExpMatchArray) => m[0])
      for (const id of idents) {
        if (PERMITTED_BASIS_VARS.includes(id)) continue
        if (economyNames.includes(id)) continue
        if (ALLOWED_FNS.includes(id)) continue
        throw new Error(`${at}: ledger basis references unknown identifier '${id}'`)
      }
    }
  }
}

// imported, not redeclared — src/validate/minigameChecks.ts owns this rule.
// Two copies of one rule is how an earlier cycle in this project shipped a
// matchability check that disagreed with its own implementation.
import { WHEN_BY_FORMAT } from '../../src/validate/minigameChecks'
import { slotsFor } from '../../src/engine/minigamePick'

export function expectValidInstanceFile(dataPath: string): void {
  expectValidAgainst('data/schema/minigame-instance.schema.json', dataPath)

  const { instances } = loadJson<any>(dataPath)
  const { minigames } = loadJson<any>('data/minigames/registry.json')
  const { formats } = loadJson<any>('data/minigames/formats.json')
  const actions = loadJson<any>('data/actions.json').actions

  const mg = Object.fromEntries(minigames.map((m: any) => [m.id, m]))
  const fmt = Object.fromEntries(formats.map((f: any) => [f.id, f]))

  // which difficulties each minigame is actually invoked at (including pool slots)
  const demanded: Record<string, Set<number>> = {}
  for (const a of actions) {
    for (const s of slotsFor(a)) {
      ;(demanded[s.minigame] = demanded[s.minigame] ?? new Set()).add(s.difficulty)
    }
  }

  for (const i of instances) {
    const at = `instance '${i.id}'`
    const m = mg[i.minigame]
    if (!m) throw new Error(`${at}: unknown minigame '${i.minigame}'`)

    const want = demanded[i.minigame]
    if (!want || !want.has(i.difficulty)) {
      throw new Error(
        `${at}: difficulty ${i.difficulty} is never demanded for '${i.minigame}' ` +
        `(actions use: ${[...(want ?? [])].sort().join(', ') || 'none'})`,
      )
    }

    const format = fmt[m.format]
    if (!format) throw new Error(`${at}: minigame '${i.minigame}' names unknown format '${m.format}'`)
    for (const k of Object.keys(i.levers)) {
      if (!(k in format.levers)) {
        throw new Error(`${at}: lever '${k}' is not declared by format '${m.format}'`)
      }
    }

    const allowed = WHEN_BY_FORMAT[m.format]
    if (!allowed) {
      throw new Error(`${at}: format '${m.format}' has no declared wrong_outcomes when values`)
    }
    const whens = i.wrong_outcomes.map((w: any) => w.when)
    for (const w of whens) {
      if (!allowed.includes(w)) {
        throw new Error(`${at}: wrong_outcomes when '${w}' is not valid for format '${m.format}'`)
      }
    }
    if (whens.includes('any') && whens.length > 1) {
      throw new Error(`${at}: mixes 'any' with a specific wrong_outcomes when`)
    }
    if (new Set(whens).size !== whens.length) {
      throw new Error(`${at}: duplicate wrong_outcomes when values`)
    }

    const solStr = JSON.stringify(Object.values(i.solution))
    for (const d of i.distractors ?? []) {
      if (solStr.includes(JSON.stringify(d.choice))) {
        throw new Error(`${at}: distractor '${d.choice}' duplicates the solution`)
      }
    }
  }
}
