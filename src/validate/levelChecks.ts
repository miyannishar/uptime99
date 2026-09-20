import { loadJson } from './loadJson'

export function loadLevels(): any[] {
  return loadJson<any>('data/levels.json').levels
}

/** Levels must be contiguous from 1, unique, and monotonically harder. */
export function checkLevelShape(levels: any[]): string[] {
  const problems: string[] = []
  const seen = new Set<number>()
  for (const l of levels) {
    if (seen.has(l.level)) problems.push(`duplicate level number ${l.level}`)
    seen.add(l.level)
  }
  const sorted = [...levels].sort((a, b) => a.level - b.level)
  sorted.forEach((l, i) => {
    if (l.level !== i + 1) {
      problems.push(
        `levels must be contiguous from 1 with no gap — found ${l.level} at position ${i + 1}`,
      )
    }
  })
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.arrival_mean_ticks > prev.arrival_mean_ticks) {
      problems.push(
        `level ${cur.level}: arrival_mean_ticks ${cur.arrival_mean_ticks} is larger than ` +
        `level ${prev.level}'s ${prev.arrival_mean_ticks} — incidents would arrive LESS often ` +
        `at a higher level`,
      )
    }
    if (cur.severity_max < prev.severity_max) {
      problems.push(
        `level ${cur.level}: severity_max ${cur.severity_max} is below level ${prev.level}'s ` +
        `${prev.severity_max} — a higher level would admit milder incidents`,
      )
    }
    if (cur.max_concurrent < prev.max_concurrent) {
      problems.push(
        `level ${cur.level}: max_concurrent ${cur.max_concurrent} is below level ${prev.level}'s ` +
        `${prev.max_concurrent}`,
      )
    }
  }
  return problems
}

/**
 * Every level must admit at least one incident. A severity_max that no incident
 * satisfies produces a level where nothing can ever happen — the analogue of the
 * minigame difficulty-slot check, which caught five real authoring gaps.
 */
export function checkLevelIncidentCoverage(levels: any[], incidents: any[]): string[] {
  const problems: string[] = []
  for (const l of levels) {
    const eligible = incidents.filter((i) => i.severity <= l.severity_max)
    if (eligible.length === 0) {
      problems.push(
        `level ${l.level}: severity_max ${l.severity_max} admits no incident at all — ` +
        `nothing could ever happen at this level`,
      )
      continue
    }
    const families = new Set(eligible.map((i) => i.family)).size
    if (eligible.length < 10) {
      problems.push(
        `level ${l.level}: severity_max ${l.severity_max} admits only ${eligible.length} ` +
        `incident(s) across ${families} famil${families === 1 ? 'y' : 'ies'} — thin enough that ` +
        `a session will repeat itself`,
      )
    }
  }
  return problems
}

/** A scenario either names a level that exists, or carries its own difficulty block. */
export function checkScenarioLevelRefs(scenarios: any[], levels: any[]): string[] {
  const problems: string[] = []
  const byLevel = new Set(levels.map((l) => l.level))
  for (const s of scenarios) {
    if (s.level === null || s.level === undefined) {
      if (!s.difficulty) {
        problems.push(
          `scenario '${s.id}': level is null, so it must carry its own 'difficulty' block ` +
          `(arrival_mean_ticks, severity_max, max_concurrent)`,
        )
      }
      continue
    }
    if (!byLevel.has(s.level)) {
      problems.push(`scenario '${s.id}': names level ${s.level}, which data/levels.json does not define`)
    }
  }
  return problems
}
