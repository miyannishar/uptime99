/* Pure prompt-building module — no side effects, no node:* imports.
   Builds the OpenAI prompt for puzzle text rewriting and filters the response. */

export interface AiRequestBody {
  readonly instance: {
    id: string
    brief: string
    reveal?: string
    given: unknown
    wrong_outcomes: unknown
    solution: unknown
  }
  readonly ai_fields: readonly string[]
  readonly context: Readonly<Record<string, string | number | null>>
}

/**
 * Build the system and user messages for the AI puzzle-rewrite request.
 *
 * System: spec §#3 "Prompt (system)" with ai_fields list substituted.
 * User:   JSON of the puzzle text fields, the solution (marked do-not-reveal),
 *         and the live context.
 */
/**
 * Models reproduce plain keys reliably and bracketed paths poorly, so the prompt
 * speaks in aliases ("wrong_outcome_texts", "given_rule") and filterAiResponse
 * maps them back to ai_fields paths.
 */
export function modelKey(path: string): string {
  if (path === 'wrong_outcomes[].shows') return 'wrong_outcome_texts'
  return path.replace(/\./g, '_')
}

export function buildAiPrompt(body: AiRequestBody): { system: string; user: string } {
  const { instance, ai_fields, context } = body

  // System prompt — substitute the ai_fields list into the template
  const fieldsList = ai_fields.map(modelKey).join(', ')
  const system =
    `You rewrite the text of an SRE training puzzle so it reads like a real incident on the player's live system. ` +
    `Keep every number, identifier and fact exactly as given — the answer depends on them. ` +
    `Do not reveal or change the answer. ` +
    `Use the live context (node, tier, health, utilisation, incident) for flavour. ` +
    `Write like an on-call engineer in the incident channel: terse, present tense, specific. ` +
    `Name the affected node (live_context.node_name) and, if present, the incident (live_context.incident_name) in the brief, woven into the story — never as a list ("the node is X, tier is Y"). ` +
    `Keep each field within 30% of its original length. ` +
    `Reply with a JSON object containing only these keys: ${fieldsList}. ` +
    `Return every key in fields_to_rewrite, with the same key names. ` +
    `For array fields return an array with exactly the same length.`

  // The exact current value of every field the model must return, under the
  // same key, so array fields such as wrong_outcomes[].shows are not dropped.
  const fieldsToRewrite: Record<string, unknown> = {}
  for (const f of ai_fields) {
    const k = modelKey(f)
    if (f === 'wrong_outcomes[].shows') {
      fieldsToRewrite[k] = ((instance.wrong_outcomes as any[]) ?? []).map((w) => w?.shows)
    } else if (f.startsWith('given.')) {
      fieldsToRewrite[k] = (instance.given as any)?.[f.slice('given.'.length)]
    } else {
      fieldsToRewrite[k] = (instance as any)[f]
    }
  }

  const user = JSON.stringify({
    fields_to_rewrite: fieldsToRewrite,
    // Everything else about the puzzle, for facts only — not to be rewritten.
    puzzle_facts: { given: instance.given },
    answer_do_not_reveal: instance.solution,
    live_context: context,
  })

  return { system, user }
}

/**
 * Filter the raw JSON string returned by the AI to only the keys listed in ai_fields.
 * Returns null if the raw string is not valid JSON or not a plain object.
 */
export function filterAiResponse(
  raw: string,
  aiFields: readonly string[],
): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const obj = parsed as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of aiFields) {
    // Accept the alias the prompt used, or the raw path if the model echoed it.
    for (const k of [modelKey(key), key]) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        result[key] = obj[k]
        break
      }
    }
  }
  return result
}
