import type { EngineCatalog } from './catalogFrom'
import type { ScenarioDef } from './types'

export interface Difficulty {
  readonly arrival_mean_ticks: number
  readonly severity_max: number
  readonly max_concurrent: number
}

/**
 * A scenario's pacing. An explicit `difficulty` block wins; otherwise the
 * scenario's `level` selects a row from data/levels.json. Neither present is an
 * error rather than a default, because a default would let a misauthored
 * scenario play at some arbitrary difficulty instead of failing loudly.
 */
export function difficultyFor(scenario: ScenarioDef, catalog: EngineCatalog): Difficulty {
  const own = (scenario as any).difficulty
  if (own) {
    return {
      arrival_mean_ticks: own.arrival_mean_ticks,
      severity_max: own.severity_max,
      max_concurrent: own.max_concurrent,
    }
  }
  if (scenario.level === null || scenario.level === undefined) {
    throw new Error(
      `difficulty: scenario '${scenario.id}' has level null and no 'difficulty' block`,
    )
  }
  const row = catalog.levelByNumber.get(scenario.level)
  if (!row) {
    throw new Error(
      `difficulty: scenario '${scenario.id}' names level ${scenario.level}, ` +
      `which data/levels.json does not define`,
    )
  }
  return {
    arrival_mean_ticks: row.arrival_mean_ticks,
    severity_max: row.severity_max,
    max_concurrent: row.max_concurrent,
  }
}
