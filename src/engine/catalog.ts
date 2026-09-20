import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from '../validate/loadJson'

function _deepFreeze<T>(o: T, seen: WeakSet<object>): T {
  if (o === null || typeof o !== 'object') return o
  if (seen.has(o as object)) return o
  seen.add(o as object)
  if (o instanceof Map) { for (const v of (o as Map<unknown, unknown>).values()) _deepFreeze(v, seen) }
  else if (o instanceof Set) { for (const v of (o as Set<unknown>).values()) _deepFreeze(v, seen) }
  for (const v of Object.values(o as Record<string, unknown>)) _deepFreeze(v, seen)
  return Object.freeze(o)
}

/** Deep-freeze an object graph. The recursion sentinel is private; the public
 * signature takes only the value to freeze. */
export function deepFreeze<T>(o: T): T {
  return _deepFreeze(o, new WeakSet())
}

function loadDir(dir: string, key: string): any[] {
  const abs = resolve(import.meta.dirname, '../..', dir)
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => loadJson<any>(`${dir}/${f}`)[key])
}

function loadDirObjects(dir: string): any[] {
  const abs = resolve(import.meta.dirname, '../..', dir)
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json')).sort()
    .map((f) => loadJson<any>(`${dir}/${f}`))
}

export interface EngineCatalog {
  readonly nodes: readonly any[]
  readonly layers: readonly any[]
  readonly tags: readonly any[]
  readonly actions: readonly any[]
  readonly metrics: readonly any[]
  readonly economy: Readonly<Record<string, any>>
  readonly incidents: readonly any[]
  readonly formats: readonly any[]
  readonly minigames: readonly any[]
  /** Minigame instances. Renamed from `instances` (I4) to avoid collision with
   * `GameState.instances`, which are node instances. */
  readonly minigameInstances: readonly any[]
  readonly scenarios: readonly any[]
  readonly levels: readonly any[]
  readonly nodeById: ReadonlyMap<string, any>
  readonly layerById: ReadonlyMap<string, any>
  readonly tagById: ReadonlyMap<string, any>
  readonly actionById: ReadonlyMap<string, any>
  readonly metricById: ReadonlyMap<string, any>
  readonly incidentById: ReadonlyMap<string, any>
  readonly scenarioById: ReadonlyMap<string, any>
  readonly levelByNumber: ReadonlyMap<number, any>
}

/** Pure constructor: takes already-parsed JSON arrays, does no I/O.
 * The browser uses this after fetching the data files over HTTP;
 * Node uses it via `loadEngineCatalog`. */
export function catalogFrom(rawData: {
  nodes: any[]
  layers: any[]
  tags: any[]
  actions: any[]
  metrics: any[]
  economy: Record<string, any>
  incidents: any[]
  formats: any[]
  minigames: any[]
  minigameInstances: any[]
  scenarios: any[]
  levels: any[]
}): EngineCatalog {
  const {
    nodes, layers, tags, actions, metrics, economy,
    incidents, formats, minigames, minigameInstances, scenarios, levels,
  } = rawData

  const index = <T extends { id: string }>(xs: T[]) =>
    new Map(xs.map((x) => [x.id, x]))

  return deepFreeze({
    nodes,
    layers,
    tags,
    actions,
    metrics,
    economy,
    incidents,
    formats,
    minigames,
    minigameInstances,
    scenarios,
    levels,
    nodeById: index(nodes),
    layerById: index(layers),
    tagById: index(tags),
    actionById: index(actions),
    metricById: index(metrics),
    incidentById: index(incidents),
    scenarioById: index(scenarios),
    levelByNumber: new Map(levels.map((l: any) => [l.level, l])),
  }) as EngineCatalog
}

/** Node-only thin wrapper: reads the data files and calls `catalogFrom`. */
export function loadEngineCatalog(): EngineCatalog {
  const nodes = loadDir('data/nodes', 'nodes')
  const incidents = loadDir('data/incidents', 'incidents')
  const minigameInstances = loadDir('data/minigames/instances', 'instances')
  const metricsFile = loadJson<any>('data/metrics.json')
  const layers = loadJson<any>('data/layers.json').layers
  const tags = loadJson<any>('data/tags.json').tags
  const actions = loadJson<any>('data/actions.json').actions
  const scenarios = loadDirObjects('data/scenarios')

  const levels = loadJson<any>('data/levels.json').levels

  return catalogFrom({
    nodes,
    layers,
    tags,
    actions,
    metrics: metricsFile.metrics,
    economy: metricsFile.economy,
    incidents,
    formats: loadJson<any>('data/minigames/formats.json').formats,
    minigames: loadJson<any>('data/minigames/registry.json').minigames,
    minigameInstances,
    scenarios,
    levels,
  })
}
