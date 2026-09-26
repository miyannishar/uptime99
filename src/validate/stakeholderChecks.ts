/* Cross-file rules for data/stakeholders.json that the schema cannot express. */

export function checkStakeholders(stakeholders: any[], metricIds: Set<string>): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const s of stakeholders) {
    const at = `stakeholder '${s.id}'`
    if (seen.has(s.id)) problems.push(`${at}: duplicate id`)
    seen.add(s.id)
    if (s.trigger && 'metric' in s.trigger && !metricIds.has(s.trigger.metric)) {
      problems.push(`${at}: trigger names unknown metric '${s.trigger.metric}'`)
    }
    // A message with no non-negative response punishes the player whatever they
    // choose — a trap, not a decision.
    if (!(s.responses ?? []).some((r: any) => r.reputation_delta >= 0)) {
      problems.push(`${at}: every response costs reputation; give the player at least one good answer`)
    }
  }
  return problems
}
