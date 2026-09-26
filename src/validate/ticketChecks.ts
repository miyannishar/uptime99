/**
 * ticketChecks.ts — cross-file validation rules for data/tickets.json.
 *
 * Does NOT import from integrity.ts (circular dependency). The `matchable`
 * callback is passed in from integrity.ts which owns matchableTiers.
 */

/** Returns every {node, tier} pair the given action can be played on. */
export type Matchable = (actionId: string) => { node: any; tier: any }[]

/**
 * checkTicketHints enforces seven rules across tickets, scenarios, and actions.
 *
 * Rules:
 * 1. hint_actions is non-empty and every id exists in actions.
 * 2. The primary hint is offered on at least one node/tier that can satisfy
 *    the requirement (filtered by node_id or layers).
 * 3. The primary hint can actually satisfy the requirement:
 *    - min_tier  → primary must be 'upgrade_tier'
 *    - tags_any  → if primary is upgrade_tier: some candidate node has a tier
 *                  above its lowest with a required tag; otherwise
 *                  primary.on_success.tags_add must intersect tags_any
 *    - tags_all  → if primary is upgrade_tier: some candidate node has a tier
 *                  above its lowest carrying ALL required tags; otherwise
 *                  primary.on_success.tags_add must contain every tag in tags_all
 *                  (the "tag already on candidate tier" exemption is NOT granted to
 *                  any action other than upgrade_tier)
 *    - min_count → every scenario listing the ticket already has enough instances
 * 4. Per scenario listing a ticket: at least one board entry is among the candidate nodes.
 * 5. Every ticket_ids entry in every scenario exists in tickets.
 * 6. upgrade_tier is primary for at most 6 scenario-listed tickets;
 *    any other action is primary for at most 3.
 * 7. Per scenario listing a ticket: the primary must be offered at at least one board
 *    entry's STARTING tier. upgrade_tier is exempt for any entry whose node is not
 *    already at its top tier.
 */
export function checkTicketHints(
  tickets: any[],
  scenarios: any[],
  actions: any[],
  matchable: Matchable,
): string[] {
  const errors: string[] = []
  const actionMap = new Map<string, any>(actions.map((a) => [a.id, a]))
  const ticketMap = new Map<string, any>(tickets.map((t) => [t.id, t]))

  // Rule 5 — every ticket referenced by a scenario must exist
  for (const s of scenarios) {
    for (const tid of s.ticket_ids ?? []) {
      if (!ticketMap.has(tid)) {
        errors.push(`ticket '${tid}' in scenario '${s.id}': unknown ticket id`)
      }
    }
  }

  // Rule 6 — primary hint counts over scenario-listed tickets only
  const scenarioTicketIds = new Set<string>(scenarios.flatMap((s) => s.ticket_ids ?? []))
  const primaryCounts = new Map<string, number>()
  for (const t of tickets) {
    if (!scenarioTicketIds.has(t.id)) continue
    const primary: string | undefined = (t.hint_actions ?? [])[0]
    if (!primary) continue
    primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1)
  }
  for (const [actionId, count] of primaryCounts) {
    const limit = actionId === 'upgrade_tier' ? 6 : 3
    if (count > limit) {
      errors.push(
        `'${actionId}' is the primary hint for ${count} scenario-listed tickets; maximum is ${limit}`,
      )
    }
  }

  // Per-ticket checks (rules 1–4, 7)
  for (const t of tickets) {
    const tid: string = t.id
    const hints: string[] = t.hint_actions ?? []
    const req = t.requirement ?? {}

    // Rule 1 — non-empty hints, all known
    if (hints.length === 0) {
      errors.push(`ticket '${tid}': hint_actions is empty`)
      continue
    }
    let allKnown = true
    for (const h of hints) {
      if (!actionMap.has(h)) {
        errors.push(`ticket '${tid}': hint_actions references unknown action '${h}'`)
        allKnown = false
      }
    }
    if (!allKnown) continue

    const primary = hints[0]
    const primaryAction = actionMap.get(primary)!
    const tagsAdd: string[] = primaryAction.on_success?.tags_add ?? []

    // Compute candidate tiers (used by rules 2, 3, 4, 7)
    let candidates = matchable(primary)
    if (req.node_id) {
      candidates = candidates.filter((c) => c.node.id === req.node_id)
    }
    if (req.layers) {
      candidates = candidates.filter((c) => (req.layers as string[]).includes(c.node.layer))
    }

    // Rule 2 — candidates non-empty
    if (candidates.length === 0) {
      errors.push(
        `ticket '${tid}': primary hint '${primary}' is never offered on a node that can satisfy the requirement`,
      )
    }

    // Rule 3 — primary can satisfy the requirement
    if (req.min_tier !== undefined) {
      if (primary !== 'upgrade_tier') {
        errors.push(
          `ticket '${tid}': requirement has min_tier but primary hint is '${primary}', not 'upgrade_tier'`,
        )
      }
    } else if (req.tags_any) {
      if (primary === 'upgrade_tier') {
        // upgrade_tier satisfies tags_any if some candidate node has a tier above
        // its lowest (in the candidate set) that carries a required tag
        const byNode = groupByNode(candidates)
        const satisfied = [...byNode.values()].some((tiers) => {
          const minNum = Math.min(...tiers.map((t) => t.tier.tier as number))
          return tiers.some(
            (t) =>
              (t.tier.tier as number) > minNum &&
              (req.tags_any as string[]).some((tag) =>
                ((t.tier.tags ?? []) as string[]).includes(tag),
              ),
          )
        })
        if (!satisfied) {
          errors.push(
            `ticket '${tid}': primary hint 'upgrade_tier' cannot satisfy tags_any requirement ` +
              `(no candidate node reaches a tier that carries one of [${(req.tags_any as string[]).join(', ')}])`,
          )
        }
      } else {
        const intersects = tagsAdd.some((tag: string) => (req.tags_any as string[]).includes(tag))
        if (!intersects) {
          errors.push(
            `ticket '${tid}': primary hint '${primary}' cannot satisfy tags_any requirement ` +
              `(grants [${tagsAdd.join(', ')}], need one of [${(req.tags_any as string[]).join(', ')}])`,
          )
        }
      }
    } else if (req.tags_all) {
      if (primary === 'upgrade_tier') {
        // upgrade_tier satisfies tags_all if some candidate node has a tier above
        // its lowest that carries ALL required tags
        const byNode = groupByNode(candidates)
        const satisfied = [...byNode.values()].some((tiers) => {
          const minNum = Math.min(...tiers.map((t) => t.tier.tier as number))
          return tiers.some(
            (t) =>
              (t.tier.tier as number) > minNum &&
              (req.tags_all as string[]).every((tag) =>
                ((t.tier.tags ?? []) as string[]).includes(tag),
              ),
          )
        })
        if (!satisfied) {
          errors.push(
            `ticket '${tid}': primary hint 'upgrade_tier' cannot satisfy tags_all requirement ` +
              `(no candidate node reaches a tier that carries all of [${(req.tags_all as string[]).join(', ')}])`,
          )
        }
      } else {
        // Non-upgrade_tier must grant every required tag — no "already on candidate tier" exemption
        for (const tag of req.tags_all as string[]) {
          if (!tagsAdd.includes(tag)) {
            errors.push(
              `ticket '${tid}': primary hint '${primary}' cannot satisfy tags_all requirement ` +
                `(tag '${tag}' not granted by the action)`,
            )
          }
        }
      }
    } else if (req.min_count !== undefined) {
      const defId = req.node_id
      const scenariosListingThis = scenarios.filter((s) =>
        (s.ticket_ids ?? []).includes(tid),
      )
      for (const s of scenariosListingThis) {
        const count = ((s.board ?? []) as any[]).filter((b) => b.def_id === defId).length
        if (count < (req.min_count as number)) {
          errors.push(
            `ticket '${tid}' in scenario '${s.id}': requires adding a node, which the run phase cannot do`,
          )
          break
        }
      }
    }

    // Rule 4 — per scenario listing the ticket, at least one board node is a candidate
    const candidateNodeIds = new Set(candidates.map((c) => c.node.id))
    const scenariosListingThis = scenarios.filter((s) =>
      (s.ticket_ids ?? []).includes(tid),
    )
    for (const s of scenariosListingThis) {
      const boardDefIds = ((s.board ?? []) as any[]).map((b) => b.def_id)
      if (!boardDefIds.some((id: string) => candidateNodeIds.has(id))) {
        errors.push(
          `ticket '${tid}' in scenario '${s.id}': no board node can take primary hint '${primary}'`,
        )
      }
    }

    // Rule 7 — per scenario, primary clickable at some board entry's starting tier
    for (const s of scenariosListingThis) {
      const boardEntries = (s.board ?? []) as { def_id: string; tier: number }[]
      if (primary === 'upgrade_tier') {
        // Exempt if at least one relevant board entry is not at its node's top tier
        const anyEligible = boardEntries.some((entry) => {
          const entryCandidates = candidates.filter((c) => c.node.id === entry.def_id)
          if (entryCandidates.length === 0) return false
          const node = entryCandidates[0].node
          const maxTier = Math.max(...(node.tiers as any[]).map((tt: any) => tt.tier as number))
          return entry.tier < maxTier
        })
        if (!anyEligible) {
          errors.push(
            `ticket '${tid}' in scenario '${s.id}': primary hint 'upgrade_tier' is not actionable ` +
              `at any board node's starting tier (all matching nodes already at top tier)`,
          )
        }
      } else {
        const anyClickable = boardEntries.some((entry) =>
          candidates.some(
            (c) => c.node.id === entry.def_id && (c.tier.tier as number) === entry.tier,
          ),
        )
        if (!anyClickable) {
          errors.push(
            `ticket '${tid}' in scenario '${s.id}': primary hint '${primary}' ` +
              `is not offered at any board node's starting tier`,
          )
        }
      }
    }
  }

  return errors
}

/** Group candidate {node, tier} pairs by node id. */
function groupByNode(
  candidates: { node: any; tier: any }[],
): Map<string, { node: any; tier: any }[]> {
  const map = new Map<string, { node: any; tier: any }[]>()
  for (const c of candidates) {
    const arr = map.get(c.node.id) ?? []
    arr.push(c)
    map.set(c.node.id, arr)
  }
  return map
}
