/* Spend and access guards for the dev AI endpoint. Pure: no I/O, no clock reads —
   the caller passes the date and persists the counters. Every guard fails closed. */

/** Models the endpoint may call. Anything else in OPENAI_MODEL falls back to the default. */
export const ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano'] as const
export const DEFAULT_MODEL = 'gpt-4o-mini'

/** Hard ceiling on generated tokens per request (a rewrite needs a few hundred). */
export const MAX_OUTPUT_TOKENS = 700

export function pickModel(requested: string | undefined): string {
  return requested && (ALLOWED_MODELS as readonly string[]).includes(requested) ? requested : DEFAULT_MODEL
}

/**
 * Only the game's own page may use the endpoint. A browser attaches `Origin` to a
 * cross-site POST, so a foreign page is rejected; requiring `application/json`
 * forces a CORS preflight that the dev server does not answer for other origins.
 * Requests with no Origin (curl, scripts on this machine) are rejected too.
 */
export function isAllowedRequest(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  allowedHosts: readonly string[],
): boolean {
  const ct = String(headers['content-type'] ?? '')
  if (!ct.toLowerCase().startsWith('application/json')) return false
  const origin = headers['origin']
  if (typeof origin !== 'string') return false
  try {
    const u = new URL(origin)
    return allowedHosts.includes(u.host)
  } catch {
    return false
  }
}

export interface DailyUsage {
  readonly date: string          // YYYY-MM-DD
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface SpendLimits {
  readonly maxRequestsPerDay: number
  readonly maxTokensPerDay: number
}

export const DEFAULT_LIMITS: SpendLimits = { maxRequestsPerDay: 200, maxTokensPerDay: 400_000 }

/** Parse a positive integer env override, keeping the default on anything else. */
export function limitsFrom(env: Readonly<Record<string, string | undefined>>): SpendLimits {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v)
    return Number.isInteger(x) && x > 0 ? x : d
  }
  return {
    maxRequestsPerDay: n(env.OPENAI_DAILY_REQUEST_CAP, DEFAULT_LIMITS.maxRequestsPerDay),
    maxTokensPerDay: n(env.OPENAI_DAILY_TOKEN_CAP, DEFAULT_LIMITS.maxTokensPerDay),
  }
}

/** Usage for today: yesterday's counters roll over to zero. */
export function usageFor(today: string, stored: DailyUsage | null): DailyUsage {
  return stored && stored.date === today ? stored : { date: today, requests: 0, inputTokens: 0, outputTokens: 0 }
}

export function withinLimits(u: DailyUsage, limits: SpendLimits): boolean {
  return u.requests < limits.maxRequestsPerDay && u.inputTokens + u.outputTokens < limits.maxTokensPerDay
}

export function recordUsage(u: DailyUsage, inputTokens: number, outputTokens: number): DailyUsage {
  return {
    ...u,
    requests: u.requests + 1,
    inputTokens: u.inputTokens + Math.max(0, inputTokens | 0),
    outputTokens: u.outputTokens + Math.max(0, outputTokens | 0),
  }
}

/** Rough USD estimate for the log line, at gpt-4o-mini list prices. */
export function estimateUsd(u: DailyUsage): number {
  return (u.inputTokens * 0.15 + u.outputTokens * 0.6) / 1_000_000
}
