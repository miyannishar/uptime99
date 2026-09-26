import { describe, it, expect } from 'vitest'
import { createAiClient } from '../src/ui/ai/aiClient'

const instance = {
  id: 'x',
  brief: 'The pool holds 5 connections but Puma runs 12 threads per process.',
  given: {},
  solution: { answer: 12 },
  wrong_outcomes: [{ when: 'wrong_edit', shows: 'Requests queue for 5 s on 7 of 12 threads.', why_wrong: 'x'.repeat(20) }],
}
const fields = ['brief', 'wrong_outcomes[].shows']
const okPatch = {
  brief: 'checkout-api on Tier 2: the pool holds 5 connections while Puma runs 12 threads per process.',
  'wrong_outcomes[].shows': ['Checkout requests queue for 5 s on 7 of 12 threads at peak.'],
}
const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeFetch(responses: Array<{ status: number; body: unknown } | 'throw'>) {
  const calls: unknown[] = []
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)))
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (r === 'throw') throw new Error('network')
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('aiClient', () => {
  it('caches a validated patch', async () => {
    const f = fakeFetch([{ status: 200, body: { patch: okPatch } }])
    const c = createAiClient({ fetchImpl: f.impl, storage: null })
    c.prefetch('k1', instance, fields, { node_name: 'checkout-api' })
    await tick(); await tick()
    expect(c.get('k1')).toEqual(okPatch)
    c.prefetch('k1', instance, fields, {})
    await tick()
    expect(f.calls).toHaveLength(1)
  })

  it('rejects a patch that drops a number the answer depends on', async () => {
    const bad = { ...okPatch, brief: 'The pool is too small for the thread count on checkout-api right now.' }
    const f = fakeFetch([{ status: 200, body: { patch: bad } }])
    const c = createAiClient({ fetchImpl: f.impl, storage: null })
    c.prefetch('k1', instance, fields, {})
    await tick(); await tick()
    expect(c.get('k1')).toBeNull()
  })

  it('spends at most the budget', async () => {
    const f = fakeFetch([{ status: 200, body: { patch: okPatch } }])
    const c = createAiClient({ fetchImpl: f.impl, budget: 1, storage: null })
    c.prefetch('a', instance, fields, {})
    c.prefetch('b', instance, fields, {})
    await tick(); await tick()
    expect(f.calls).toHaveLength(1)
  })

  it('stops calling after no_key', async () => {
    const f = fakeFetch([{ status: 503, body: { error: 'no_key' } }])
    const c = createAiClient({ fetchImpl: f.impl, storage: null })
    c.prefetch('a', instance, fields, {})
    await tick(); await tick()
    c.prefetch('b', instance, fields, {})
    await tick(); await tick()
    expect(f.calls).toHaveLength(1)
    expect(c.get('a')).toBeNull()
  })

  it('treats a network error as no patch and does not retry', async () => {
    const f = fakeFetch(['throw'])
    const c = createAiClient({ fetchImpl: f.impl, storage: null })
    c.prefetch('a', instance, fields, {})
    await tick(); await tick()
    c.prefetch('a', instance, fields, {})
    await tick()
    expect(c.get('a')).toBeNull()
    expect(f.calls).toHaveLength(1)
  })

  it('never sends more than maxInFlight at once', async () => {
    let inFlight = 0, peak = 0
    const impl = (async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return new Response(JSON.stringify({ patch: okPatch }), { status: 200 })
    }) as unknown as typeof fetch
    const c = createAiClient({ fetchImpl: impl, maxInFlight: 2, storage: null })
    for (const k of ['a', 'b', 'c', 'd']) c.prefetch(k, instance, fields, {})
    await new Promise((r) => setTimeout(r, 40))
    expect(peak).toBe(2)
    expect(c.get('d')).toEqual(okPatch)
  })
})

describe('aiClient upstream auth failure', () => {
  it('stops calling after the endpoint reports a 401 from OpenAI', async () => {
    const f = fakeFetch([{ status: 502, body: { error: 'upstream_error', status: 401, code: 'token_invalidated' } }])
    const c = createAiClient({ fetchImpl: f.impl, storage: null })
    c.prefetch('a', instance, fields, {})
    await tick(); await tick()
    c.prefetch('b', instance, fields, {})
    await tick(); await tick()
    expect(f.calls).toHaveLength(1)
  })
})

describe('aiClient daily budget', () => {
  it('persists across page loads and resets the next day', async () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    const f = fakeFetch([{ status: 200, body: { patch: okPatch } }])
    const day = { d: '2026-09-25' }
    const load = () => createAiClient({ fetchImpl: f.impl, budget: 2, storage, today: () => day.d })
    const a = load(); a.prefetch('k1', instance, fields, {}); a.prefetch('k2', instance, fields, {})
    await tick(); await tick()
    const b = load(); b.prefetch('k3', instance, fields, {})   // a "reload": budget already spent today
    await tick(); await tick()
    expect(f.calls).toHaveLength(2)
    day.d = '2026-09-26'
    const c = load(); c.prefetch('k4', instance, fields, {})
    await tick(); await tick()
    expect(f.calls).toHaveLength(3)
  })
})
