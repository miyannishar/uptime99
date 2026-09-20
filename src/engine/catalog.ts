/* The Node-only half of the catalogue: reads the data files off disk and hands
   them to the pure constructor in `catalogFrom.ts`.

   This module imports `node:fs` and `node:path` and is therefore the ONE engine
   module deliberately excluded from `check:browser`. Everything a browser needs
   — `catalogFrom`, `deepFreeze`, `EngineCatalog` — lives in `catalogFrom.ts`
   instead. Do not re-export them from here: a value re-export would make it
   possible to import them through this module again and silently pull `node:fs`
   into a browser bundle, which is the exact failure this split fixed. */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadJson } from '../validate/loadJson'
import { catalogFrom, type EngineCatalog } from './catalogFrom'

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
