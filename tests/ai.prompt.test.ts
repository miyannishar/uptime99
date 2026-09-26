import { describe, it, expect } from 'vitest'
import { buildAiPrompt, filterAiResponse, type AiRequestBody } from '../src/ai/prompt'

const baseInstance = {
  id: 'test-instance-1',
  brief: 'The cache hit rate has dropped to 40%, causing p95 latency of 250ms.',
  reveal: 'Redis was restarted without warming the cache.',
  given: { threshold: 75, unit: 'pct' },
  wrong_outcomes: [
    { when: 'below', shows: 'Cache still cold — hit rate remains at 30%.' },
    { when: 'above', shows: 'Over-eviction: memory pressure at 90%.' },
  ],
  solution: { value: 75 },
}

const baseBody: AiRequestBody = {
  instance: baseInstance,
  ai_fields: ['brief', 'reveal', 'wrong_outcomes[].shows'],
  context: {
    node: 'redis-primary',
    tier: 2,
    health: 45,
    utilization_pct: 88,
    incident: 'cache_eviction_storm',
  },
}

describe('buildAiPrompt', () => {
  it('system prompt lists exactly the ai_fields, by their model-facing alias', () => {
    const { system } = buildAiPrompt(baseBody)
    expect(system).toContain('brief, reveal, wrong_outcome_texts')
  })

  it('system prompt does not list keys outside ai_fields', () => {
    const body: AiRequestBody = { ...baseBody, ai_fields: ['brief'] }
    const { system } = buildAiPrompt(body)
    expect(system).toContain('brief')
    // The keys listing should end at 'brief' with no extra comma-separated entries
    expect(system).not.toContain('reveal,')
    expect(system).not.toContain('wrong_outcomes[].shows,')
  })

  it('user JSON contains answer_do_not_reveal', () => {
    const { user } = buildAiPrompt(baseBody)
    const parsed = JSON.parse(user)
    expect(parsed).toHaveProperty('answer_do_not_reveal')
    expect(parsed.answer_do_not_reveal).toEqual(baseInstance.solution)
  })

  it('user JSON contains live_context with all context keys', () => {
    const { user } = buildAiPrompt(baseBody)
    const parsed = JSON.parse(user)
    expect(parsed).toHaveProperty('live_context')
    expect(parsed.live_context).toMatchObject(baseBody.context)
  })

  it('user JSON hands the model the current brief to rewrite', () => {
    const { user } = buildAiPrompt(baseBody)
    const parsed = JSON.parse(user)
    expect(parsed.fields_to_rewrite.brief).toBe(baseInstance.brief)
  })

  it('user JSON contains given for facts', () => {
    const { user } = buildAiPrompt(baseBody)
    const parsed = JSON.parse(user)
    expect(parsed.puzzle_facts.given).toEqual(baseInstance.given)
  })

  it('user JSON hands the model every wrong-outcome text, one per entry, when in ai_fields', () => {
    const { user } = buildAiPrompt(baseBody)
    const parsed = JSON.parse(user)
    expect(parsed.fields_to_rewrite['wrong_outcome_texts']).toEqual(
      (baseInstance.wrong_outcomes as any[]).map((w) => w.shows),
    )
  })

  it('user JSON omits wrong_outcomes when not in ai_fields', () => {
    const body: AiRequestBody = { ...baseBody, ai_fields: ['brief'] }
    const { user } = buildAiPrompt(body)
    const parsed = JSON.parse(user)
    expect(parsed.fields_to_rewrite).not.toHaveProperty('wrong_outcome_texts')
  })
})

describe('filterAiResponse', () => {
  it('keeps only keys listed in ai_fields', () => {
    const raw = JSON.stringify({
      brief: 'Rewritten brief text here.',
      unknown_key: 'should be dropped',
      another_extra: 123,
    })
    const result = filterAiResponse(raw, ['brief', 'reveal'])
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('brief')
    expect(result).not.toHaveProperty('unknown_key')
    expect(result).not.toHaveProperty('another_extra')
  })

  it('drops keys that are not in ai_fields even when present in response', () => {
    const raw = JSON.stringify({
      solution: 'should be dropped',
      brief: 'keep this',
    })
    const result = filterAiResponse(raw, ['brief'])
    expect(result).toEqual({ brief: 'keep this' })
  })

  it('returns null for non-JSON input', () => {
    expect(filterAiResponse('not json', ['brief'])).toBeNull()
  })

  it('returns null for a JSON array', () => {
    expect(filterAiResponse('[1,2]', ['brief'])).toBeNull()
  })

  it('returns null for JSON null', () => {
    expect(filterAiResponse('null', ['brief'])).toBeNull()
  })

  it('returns null for a JSON string', () => {
    expect(filterAiResponse('"hello"', ['brief'])).toBeNull()
  })

  it('returns an empty object when ai_fields are absent from the response', () => {
    const raw = JSON.stringify({ other: 'value' })
    const result = filterAiResponse(raw, ['brief', 'reveal'])
    expect(result).toEqual({})
  })

  it('returns all matched ai_fields when present', () => {
    const raw = JSON.stringify({
      brief: 'new brief',
      'wrong_outcomes[].shows': ['outcome 1', 'outcome 2'],
    })
    const result = filterAiResponse(raw, ['brief', 'wrong_outcomes[].shows'])
    expect(result).toEqual({
      brief: 'new brief',
      'wrong_outcomes[].shows': ['outcome 1', 'outcome 2'],
    })
  })
})

describe('model key aliases', () => {
  it('maps aliases in the model reply back to ai_fields paths', () => {
    const out = filterAiResponse(JSON.stringify({ brief: 'b', wrong_outcome_texts: ['x'], given_rule: 'r', junk: 1 }),
      ['brief', 'wrong_outcomes[].shows', 'given.rule'])
    expect(out).toEqual({ brief: 'b', 'wrong_outcomes[].shows': ['x'], 'given.rule': 'r' })
  })
})
