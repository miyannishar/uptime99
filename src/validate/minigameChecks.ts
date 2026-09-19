import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from './loadJson'

const INSTANCE_DIR = 'data/minigames/instances'

export function loadMinigameData() {
  const dir = resolve(import.meta.dirname, '../..', INSTANCE_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return {
    formats: loadJson<any>('data/minigames/formats.json').formats,
    minigames: loadJson<any>('data/minigames/registry.json').minigames,
    instances: files.flatMap((f) => loadJson<any>(`${INSTANCE_DIR}/${f}`).instances),
  }
}

export function checkRegistryMatchesActions(minigames: any[], actions: any[]): string[] {
  const problems: string[] = []
  const inRegistry = new Set(minigames.map((m) => m.id))
  const inActions = new Set(actions.map((a) => a.minigame))
  for (const id of inActions) {
    if (!inRegistry.has(id)) problems.push(`action references minigame '${id}' absent from registry.json`)
  }
  for (const id of inRegistry) {
    if (!inActions.has(id)) problems.push(`registry holds minigame '${id}' that no action uses`)
  }
  return problems
}

export function checkFormatsResolve(minigames: any[], formats: any[]): string[] {
  const ids = new Set(formats.map((f) => f.id))
  return minigames
    .filter((m) => !ids.has(m.format))
    .map((m) => `minigame '${m.id}': unknown format '${m.format}'`)
}

export function checkSlotCoverage(instances: any[], actions: any[]): string[] {
  const have = new Set(instances.map((i) => `${i.minigame}:${i.difficulty}`))
  const need = new Set(actions.map((a) => `${a.minigame}:${a.difficulty}`))
  return [...need]
    .filter((s) => !have.has(s))
    .sort()
    .map((s) => `no instance for slot '${s}' — an action selects it and the pool would be empty`)
}

export function checkInstanceRefs(instances: any[], minigames: any[], formats: any[]): string[] {
  const problems: string[] = []
  const mg = Object.fromEntries(minigames.map((m) => [m.id, m]))
  const fmt = Object.fromEntries(formats.map((f) => [f.id, f]))
  for (const i of instances) {
    const m = mg[i.minigame]
    if (!m) { problems.push(`instance '${i.id}': unknown minigame '${i.minigame}'`); continue }
    const f = fmt[m.format]
    if (!f) { problems.push(`instance '${i.id}': minigame names unknown format '${m.format}'`); continue }
    for (const k of Object.keys(i.levers)) {
      if (!(k in f.levers)) {
        problems.push(`instance '${i.id}': lever '${k}' not declared by format '${m.format}'`)
      }
    }
  }
  return problems
}

/**
 * Which `wrong_outcomes[].when` values each format permits.
 *
 * This is the single source of truth. The instance schema's `when` enum is the
 * flat union of all seven values across all formats and cannot discriminate by
 * format, so without this map a dial instance carrying `wrong_order` validates
 * cleanly. `tests/helpers/dataFiles.ts` imports this rather than declaring its
 * own copy — one rule, one implementation.
 */
export const WHEN_BY_FORMAT: Record<string, string[]> = {
  ordered_sequence: ['any', 'wrong_order'],
  fill_blank: ['any', 'wrong_value'],
  dial: ['any', 'below', 'above'],
  wiring: ['any', 'wrong_target'],
  evidence: ['any', 'wrong_choice'],
}

/**
 * Required `given`/`solution` keys per format.
 *
 * The instance schema types both fields as bare objects, because an instance
 * names a minigame rather than a format and so the schema cannot know which
 * shape to demand. That left their entire contents unvalidated: a typo such as
 * `{"vlaue": 5}` passed everything. This table is the compensating control.
 *
 * Presence and type only — extra keys are allowed, because instances
 * legitimately carry optional extras (`facts`, `options`, `language`,
 * `context`, `edges`) and rejecting unknowns would fail valid data. Requiring
 * the known keys is what catches a typo: the misspelling leaves the real key
 * missing.
 */
type Req = { path: string; test: (v: any) => boolean; want: string }

const nonEmptyString = (v: any) => typeof v === 'string' && v.length > 0
const nonEmptyArray = (v: any) => Array.isArray(v) && v.length > 0
const plainObject = (v: any) => typeof v === 'object' && v !== null && !Array.isArray(v)

const SHAPE_BY_FORMAT: Record<string, { given: Req[]; solution: Req[] }> = {
  ordered_sequence: {
    given: [{ path: 'steps', test: nonEmptyArray, want: 'a non-empty array' }],
    solution: [{
      path: 'order',
      test: (v) => nonEmptyArray(v) && v.every((n: any) => Number.isInteger(n)),
      want: 'a non-empty array of integers',
    }],
  },
  fill_blank: {
    given: [{ path: 'template', test: nonEmptyString, want: 'a non-empty string' }],
    solution: [{
      path: 'blanks',
      test: (v) => plainObject(v) && Object.keys(v).length > 0,
      want: 'an object with at least one key',
    }],
  },
  dial: {
    given: [
      { path: 'table', test: nonEmptyArray, want: 'a non-empty array' },
      { path: 'unit', test: nonEmptyString, want: 'a non-empty string' },
      {
        path: 'range',
        test: (v) => plainObject(v) && typeof v.min === 'number' && typeof v.max === 'number',
        want: 'an object with numeric min and max',
      },
    ],
    solution: [{ path: 'value', test: (v) => typeof v === 'number', want: 'a number' }],
  },
  wiring: {
    given: [
      { path: 'nodes', test: nonEmptyArray, want: 'a non-empty array' },
      { path: 'zones', test: nonEmptyArray, want: 'a non-empty array' },
      { path: 'place', test: plainObject, want: 'an object' },
    ],
    solution: [
      { path: 'zone', test: nonEmptyString, want: 'a non-empty string' },
      { path: 'connect_to', test: nonEmptyArray, want: 'a non-empty array' },
    ],
  },
  evidence: {
    given: [
      {
        path: 'kind',
        test: (v) => ['log', 'explain', 'deploy_history'].includes(v),
        want: "one of 'log', 'explain', 'deploy_history'",
      },
      { path: 'output', test: nonEmptyString, want: 'a non-empty string' },
    ],
    solution: [{ path: 'choice', test: nonEmptyString, want: 'a non-empty string' }],
  },
}

export function checkInstanceShapes(instances: any[], minigames: any[]): string[] {
  const problems: string[] = []
  const mg = Object.fromEntries(minigames.map((m) => [m.id, m]))

  for (const i of instances) {
    const m = mg[i.minigame]
    // an unknown minigame or format is checkInstanceRefs'/checkFormatsResolve's
    // finding to report; staying silent here avoids double-reporting one defect
    if (!m) continue
    const shape = SHAPE_BY_FORMAT[m.format]
    if (!shape) continue

    for (const field of ['given', 'solution'] as const) {
      const payload = i[field]
      if (!plainObject(payload)) {
        problems.push(`instance '${i.id}': ${field} must be an object for format '${m.format}'`)
        continue
      }
      for (const req of shape[field]) {
        if (!(req.path in payload)) {
          problems.push(
            `instance '${i.id}': ${field}.${req.path} is required for format '${m.format}' and is missing`,
          )
        } else if (!req.test(payload[req.path])) {
          problems.push(
            `instance '${i.id}': ${field}.${req.path} must be ${req.want} for format '${m.format}'`,
          )
        }
      }
    }
  }
  return problems
}

export function checkWhenLegality(instances: any[], minigames: any[]): string[] {
  const problems: string[] = []
  const mg = Object.fromEntries(minigames.map((m) => [m.id, m]))

  for (const i of instances) {
    const m = mg[i.minigame]
    if (!m) continue
    const allowed = WHEN_BY_FORMAT[m.format]
    if (!allowed) {
      problems.push(`instance '${i.id}': format '${m.format}' has no declared wrong_outcomes when values`)
      continue
    }
    if (!Array.isArray(i.wrong_outcomes)) {
      problems.push(`instance '${i.id}': wrong_outcomes must be an array`)
      continue
    }
    const whens = i.wrong_outcomes.map((w: any) => w?.when)
    for (const w of whens) {
      if (!allowed.includes(w)) {
        problems.push(`instance '${i.id}': wrong_outcomes when '${w}' is not valid for format '${m.format}'`)
      }
    }
    // a single specific entry is legal: four of the five formats have exactly
    // one specific value, so requiring two would mean duplicating it
    if (whens.includes('any') && whens.length > 1) {
      problems.push(`instance '${i.id}': mixes 'any' with a specific wrong_outcomes when`)
    }
  }
  return problems
}

export function checkInstanceIdsUnique(instances: any[]): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  for (const i of instances) {
    if (seen.has(i.id)) problems.push(`duplicate instance id '${i.id}'`)
    seen.add(i.id)
  }
  return problems
}
