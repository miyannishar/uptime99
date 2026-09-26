/* The pure half of the catalogue: the `EngineCatalog` shape, `deepFreeze`, and
   the `catalogFrom` constructor. This module does NO I/O and imports nothing
   from `node:*`, so the browser can import it directly.

   It exists as a separate module from `catalog.ts` for exactly one reason: the
   Node-only loader `loadEngineCatalog` needs `node:fs` and `node:path`, and a
   static top-level import of those in the same file made `catalogFrom`
   unreachable from a browser bundle even though `catalogFrom` itself is pure.
   The UI session hit that wall — a value import of `catalogFrom` dragged
   `node:fs` in and Vite failed the build. Keep the halves separate.

   `check:browser` bundles every `src/engine/*.ts` except `catalog.ts`, so this
   module is covered automatically and a future `node:*` import here fails the
   build. Do not add one. */

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
  readonly tickets: readonly any[]
  readonly nodeById: ReadonlyMap<string, any>
  readonly layerById: ReadonlyMap<string, any>
  readonly tagById: ReadonlyMap<string, any>
  readonly actionById: ReadonlyMap<string, any>
  readonly metricById: ReadonlyMap<string, any>
  readonly incidentById: ReadonlyMap<string, any>
  readonly scenarioById: ReadonlyMap<string, any>
  readonly levelByNumber: ReadonlyMap<number, any>
  readonly ticketById: ReadonlyMap<string, any>
  readonly stakeholders: readonly any[]
  readonly stakeholderById: ReadonlyMap<string, any>
}

/** Pure constructor: takes already-parsed JSON arrays, does no I/O.
 * The browser uses this after fetching or globbing the data files;
 * Node uses it via `loadEngineCatalog` in `catalog.ts`. */
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
  /** Optional: ticket definitions. Defaults to [] if omitted (e.g. browser contexts
   *  that have not yet wired up the tickets data file). */
  tickets?: any[]
  /** Optional: stakeholder message definitions (data/stakeholders.json). Defaults to []. */
  stakeholders?: any[]
}): EngineCatalog {
  const {
    nodes, layers, tags, actions, metrics, economy,
    incidents, formats, minigames, minigameInstances, scenarios, levels,
    tickets = [],
    stakeholders = [],
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
    tickets,
    stakeholders,
    nodeById: index(nodes),
    layerById: index(layers),
    tagById: index(tags),
    actionById: index(actions),
    metricById: index(metrics),
    incidentById: index(incidents),
    scenarioById: index(scenarios),
    levelByNumber: new Map(levels.map((l: any) => [l.level, l])),
    ticketById: index(tickets),
    stakeholderById: index(stakeholders),
  }) as EngineCatalog
}
