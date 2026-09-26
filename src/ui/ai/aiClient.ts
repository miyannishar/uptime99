/* Browser client for AI-rewritten puzzle text.

   Prefetches in the background, validates every patch with the pure
   `validateAiPatch` before caching it, and never blocks opening a minigame: `get`
   returns only what has already arrived and passed. The API key never reaches the
   browser — the dev-server endpoint holds it — and on a static deploy the endpoint
   is absent, so every request fails fast and the authored text is used. */

import { validateAiPatch, type AiPatch } from '../../engine/aiMerge'

export interface AiClient {
  prefetch(key: string, instance: any, aiFields: readonly string[], context: Record<string, string | number | null>): void
  /** Validated patch, or null when absent, pending, rejected or failed. */
  get(key: string): AiPatch | null
}

interface Job {
  key: string
  instance: any
  aiFields: readonly string[]
  context: Record<string, string | number | null>
}

const BUDGET_KEY = 'uptime99:ai-budget'

export function createAiClient(opts: {
  fetchImpl?: typeof fetch
  /** Requests allowed per calendar day across all page loads (default 40). */
  budget?: number
  maxInFlight?: number
  endpoint?: string
  /** Where the daily count persists; defaults to localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** YYYY-MM-DD; injectable for tests. */
  today?: () => string
} = {}): AiClient {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const endpoint = opts.endpoint ?? '/api/generate-task'
  const maxInFlight = opts.maxInFlight ?? 2
  // The budget is per day, not per page load: the dev server reloads the page on
  // every file edit, and a per-load budget would reset each time.
  const storage = opts.storage !== undefined ? opts.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null)
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10))
  const dailyBudget = opts.budget ?? 40
  const readUsed = (): number => {
    try {
      const v = JSON.parse(storage?.getItem(BUDGET_KEY) ?? 'null')
      return v && v.date === today() ? Number(v.used) || 0 : 0
    } catch { return 0 }
  }
  const spend = () => {
    try { storage?.setItem(BUDGET_KEY, JSON.stringify({ date: today(), used: readUsed() + 1 })) } catch { /* ignore */ }
  }
  let budget = dailyBudget - readUsed()
  let disabled = false
  let inFlight = 0

  // key → patch (validated), null (settled with nothing usable), or 'pending'
  const cache = new Map<string, AiPatch | null | 'pending'>()
  const queue: Job[] = []

  const pump = () => {
    while (!disabled && inFlight < maxInFlight && queue.length > 0) {
      const job = queue.shift()!
      inFlight++
      void run(job).finally(() => {
        inFlight--
        pump()
      })
    }
  }

  const run = async (job: Job) => {
    try {
      const { id, brief, reveal, given, wrong_outcomes, solution } = job.instance
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance: { id, brief, reveal, given, wrong_outcomes, solution },
          ai_fields: job.aiFields,
          context: job.context,
        }),
      })
      if (res.status === 503) {
        const body = await res.json().catch(() => null)
        if (body?.error === 'no_key') {
          disabled = true
          queue.length = 0
        }
        cache.set(job.key, null)
        return
      }
      if (!res.ok) {
        // A rejected or exhausted key will not recover this session — stop asking.
        const body = await res.json().catch(() => null)
        if (body?.status === 401 || body?.code === 'insufficient_quota') {
          disabled = true
          queue.length = 0
        }
        cache.set(job.key, null)
        return
      }
      const body = await res.json()
      const patch = body?.patch as AiPatch | undefined
      const ok = patch && typeof patch === 'object' && validateAiPatch(job.instance, job.aiFields, patch).ok
      cache.set(job.key, ok ? patch! : null)
    } catch {
      cache.set(job.key, null)
    }
  }

  return {
    prefetch(key, instance, aiFields, context) {
      if (disabled || cache.has(key) || aiFields.length === 0) return
      if (budget <= 0) return
      budget--
      spend()
      cache.set(key, 'pending')
      queue.push({ key, instance, aiFields, context })
      pump()
    },
    get(key) {
      const v = cache.get(key)
      return v && v !== 'pending' ? v : null
    },
  }
}
