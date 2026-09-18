export type Constraint = {
  layers?: string[]
  roles?: string[]
  node_ids?: string[]
  tags_all?: string[]
  tags_any?: string[]
  tags_none?: string[]
  min_tier?: number
  max_tier?: number
  min_health?: number
  max_health?: number
}

export type Action = { id: string; constraint: Constraint }

export type MatchInput = {
  layer: string
  role: string
  node_id: string
  tier: number
  health: number
  tags: string[]
  actions_extra?: string[]
  actions_deny?: string[]
}

function satisfies(input: MatchInput, c: Constraint): boolean {
  const tags = new Set(input.tags)
  if (c.layers && !c.layers.includes(input.layer)) return false
  if (c.roles && !c.roles.includes(input.role)) return false
  if (c.node_ids && !c.node_ids.includes(input.node_id)) return false
  if (c.tags_all && !c.tags_all.every((t) => tags.has(t))) return false
  if (c.tags_any && !c.tags_any.some((t) => tags.has(t))) return false
  if (c.tags_none && c.tags_none.some((t) => tags.has(t))) return false
  if (c.min_tier !== undefined && input.tier < c.min_tier) return false
  if (c.max_tier !== undefined && input.tier > c.max_tier) return false
  if (c.min_health !== undefined && input.health < c.min_health) return false
  if (c.max_health !== undefined && input.health > c.max_health) return false
  return true
}

export function matchActions(input: MatchInput, actions: Action[]): string[] {
  const deny = new Set(input.actions_deny ?? [])
  const matched = new Set<string>(input.actions_extra ?? [])
  for (const a of actions) if (satisfies(input, a.constraint)) matched.add(a.id)
  return [...matched].filter((id) => !deny.has(id)).sort()
}
