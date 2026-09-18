import { expect } from 'vitest'
import { compileSchema } from '../../src/validate/schemaValidator'
import { loadJson } from '../../src/validate/loadJson'

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
