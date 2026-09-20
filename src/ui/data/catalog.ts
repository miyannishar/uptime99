/* ============================================================================
   Catalog loader — the real data/ directory, not fixtures.
   ----------------------------------------------------------------------------
   Every definition the UI renders comes from the same JSON files that
   `npm run validate` and `npm test` check. There is deliberately no fixture
   copy of any of it: a fixture would drift the moment another session edits a
   tier, and the drift would be silent.

   Multi-file directories (nodes, incidents, minigame instances) are read with
   import.meta.glob so that adding an eighth node file or a sixth instance file
   needs no change here. Note the one thing glob does NOT give you: CLAUDE.md
   §13 hardcodes the expected per-family incident counts in
   src/validate/incidentChecks.ts, and that check still has to be updated by
   hand. This loader will happily show you a 50th incident that validation
   rejects, so `npm run validate` remains the authority on what is legal.
   ========================================================================== */

import type {
  ActionDef, Catalog, CatalogIndex, Economy, FormatDef, IncidentDef, LayerDef,
  LayerId, MetricDef, MinigameDef, MinigameInstanceDef, NodeDef, TagDef,
} from '../types'
import { catalogFrom } from '@engine/catalogFrom'
import type { EngineCatalog } from '@engine/catalogFrom'
import levelsRaw from '../../../data/levels.json'

import layersRaw from '../../../data/layers.json'
import tagsRaw from '../../../data/tags.json'
import actionsRaw from '../../../data/actions.json'
import metricsRaw from '../../../data/metrics.json'
import formatsRaw from '../../../data/minigames/formats.json'
import registryRaw from '../../../data/minigames/registry.json'

/* -- single files ---------------------------------------------------------- */

export const layers = (layersRaw as unknown as { layers: LayerDef[] }).layers
export const tags = (tagsRaw as unknown as { tags: TagDef[] }).tags
export const actions = (actionsRaw as unknown as { actions: ActionDef[] }).actions
export const metrics = (metricsRaw as unknown as { metrics: MetricDef[] }).metrics
export const economy = (metricsRaw as unknown as { economy: Economy }).economy
export const formats = (formatsRaw as unknown as { formats: FormatDef[] }).formats
export const minigames = (registryRaw as unknown as { minigames: MinigameDef[] }).minigames

/* -- globbed directories --------------------------------------------------- */

function flatten<T>(mods: Record<string, unknown>, key: string): T[] {
  return Object.keys(mods)
    .sort()
    .flatMap((path) => ((mods[path] as Record<string, T[]>)[key] ?? []))
}

export const nodes = flatten<NodeDef>(
  import.meta.glob('../../../data/nodes/*.json', { eager: true }),
  'nodes',
)

export const incidents = flatten<IncidentDef>(
  import.meta.glob('../../../data/incidents/*.json', { eager: true }),
  'incidents',
)

export const minigameInstances = flatten<MinigameInstanceDef>(
  import.meta.glob('../../../data/minigames/instances/*.json', { eager: true }),
  'instances',
)

/* -- assembled catalog ----------------------------------------------------- */

export const catalog: Catalog = Object.freeze({
  layers,
  tags,
  nodes,
  actions,
  metrics,
  economy,
  incidents,
  formats,
  minigames,
  instances: minigameInstances,
})

/* -- lookup indexes -------------------------------------------------------- */

export const index: CatalogIndex = {
  nodeById: new Map(nodes.map((n) => [n.id, n])),
  tagById: new Map(tags.map((t) => [t.id, t])),
  actionById: new Map(actions.map((a) => [a.id, a])),
  layerById: new Map(layers.map((l) => [l.id, l])),
  metricById: new Map(metrics.map((m) => [m.id, m])),
  incidentById: new Map(incidents.map((i) => [i.id, i])),
  minigameById: new Map(minigames.map((m) => [m.id, m])),
  formatById: new Map(formats.map((f) => [f.id, f])),
}

/* -- derived views the UI needs repeatedly --------------------------------- */

/** The four request-path layers, in `layer_index` order (edge → data). */
export const requestPathLayers: LayerDef[] = layers
  .filter((l) => l.on_request_path)
  .sort((a, b) => (a.layer_index ?? 0) - (b.layer_index ?? 0))

/** The three off-path layers, which have `layer_index: null`. */
export const offPathLayers: LayerDef[] = layers.filter((l) => !l.on_request_path)

export function nodesInLayer(layer: LayerId): NodeDef[] {
  return nodes.filter((n) => n.layer === layer)
}

export function tierOf(def: NodeDef, tier: number) {
  return def.tiers.find((t) => t.tier === tier) ?? def.tiers[0]
}

export function resolveTags(ids: readonly string[]): TagDef[] {
  return ids.map((id) => index.tagById.get(id)).filter((t): t is TagDef => Boolean(t))
}

export function resolveActions(ids: readonly string[]): ActionDef[] {
  return ids.map((id) => index.actionById.get(id)).filter((a): a is ActionDef => Boolean(a))
}

/**
 * Which minigame instances exist for a given difficulty-slot. `checkSlotCoverage`
 * guarantees at least one; five slots carry two, and the engine picks among them.
 */
export function instancesForSlot(minigameId: string, difficulty: number): MinigameInstanceDef[] {
  return minigameInstances.filter(
    (i) => i.minigame === minigameId && i.difficulty === difficulty,
  )
}

/**
 * True when a tier contributes to the p95 sum. CLAUDE.md §10: layer membership
 * plus the async/scheduled exclusion answers this completely, and there must be
 * no per-node tag for it.
 */
export function isOnRequestPath(node: NodeDef, tierTags: readonly string[]): boolean {
  const layer = index.layerById.get(node.layer)
  if (!layer?.on_request_path) return false
  return !tierTags.includes('async') && !tierTags.includes('scheduled')
}

/* -- scenarios and levels -------------------------------------------------- */

/** Each scenario JSON file is a single ScenarioDef object (not wrapped in an array).
 *  Vite wraps eager JSON imports in `{ default: ... }`, so we unwrap here. */
const scenarioMods = import.meta.glob('../../../data/scenarios/*.json', { eager: true })
export const scenarios = Object.keys(scenarioMods).sort().map(
  (path) => ((scenarioMods[path] as any).default ?? scenarioMods[path]) as any,
)

export const levels = (levelsRaw as unknown as { levels: any[] }).levels

/* -- engine catalog -------------------------------------------------------- */

/** The frozen EngineCatalog the engine functions (loadScenario, boardOf, …) require.
 *  Built once from the same data arrays already exported above. */
export const engineCatalog: EngineCatalog = catalogFrom({
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
})
