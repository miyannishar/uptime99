/* Vite dev-only plugin — adds POST /api/generate-task.
   apply: 'serve' means this code never reaches the browser bundle.
   The API key is read from the env object passed by vite.config.ts
   (loaded via Vite's loadEnv) and never logged or echoed. */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildAiPrompt, filterAiResponse, type AiRequestBody } from '../ai/prompt'
import {
  MAX_OUTPUT_TOKENS, estimateUsd, isAllowedRequest, limitsFrom, pickModel, recordUsage, usageFor, withinLimits,
  type DailyUsage,
} from '../ai/guard'

const MAX_BODY_BYTES = 64 * 1024 // 64 KB

// Daily usage survives dev-server restarts, so a restart never resets the cap.
// node_modules/ is git-ignored.
const USAGE_FILE = resolve(process.cwd(), 'node_modules/.cache/uptime99-ai-usage.json')

function loadUsage(): DailyUsage | null {
  try { return JSON.parse(readFileSync(USAGE_FILE, 'utf8')) as DailyUsage } catch { return null }
}
function saveUsage(u: DailyUsage): void {
  try { mkdirSync(dirname(USAGE_FILE), { recursive: true }); writeFileSync(USAGE_FILE, JSON.stringify(u)) } catch { /* best effort */ }
}
const today = () => new Date().toISOString().slice(0, 10)

/** Only same-origin requests from the game page on localhost may spend the key. */
function allowedHostsFor(req: any): string[] {
  const host = String(req.headers?.host ?? '')
  const name = host.split(':')[0]
  return name === 'localhost' || name === '127.0.0.1' ? [host] : []
}

function jsonResponse(res: any, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function devAiPlugin(env: Record<string, string>) {
  const limits = limitsFrom(env)
  // Identical requests (same puzzle, same live context) are answered from memory,
  // so page reloads during development do not pay twice.
  const responseCache = new Map<string, unknown>()
  return {
    name: 'dev-ai-endpoint',
    apply: 'serve' as const,
    configureServer(server: any) {
      return () => {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.method !== 'POST' || req.url !== '/api/generate-task') {
            return next()
          }
          if (!isAllowedRequest(req.headers ?? {}, allowedHostsFor(req))) {
            return jsonResponse(res, 403, { error: 'forbidden_origin' })
          }

          // Collect body with size limit
          const chunks: Buffer[] = []
          let totalBytes = 0

          req.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length
            if (totalBytes > MAX_BODY_BYTES) {
              chunks.length = 0 // signal overflow
            } else {
              chunks.push(chunk)
            }
          })

          req.on('end', async () => {
            // 413 if body too large
            if (totalBytes > MAX_BODY_BYTES) {
              return jsonResponse(res, 413, { error: 'payload_too_large' })
            }

            // Parse JSON body
            let body: unknown
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              return jsonResponse(res, 400, { error: 'invalid_json' })
            }

            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
              return jsonResponse(res, 400, { error: 'invalid_body' })
            }

            const b = body as Record<string, unknown>

            // Validate required fields
            if (
              !b.instance ||
              typeof b.instance !== 'object' ||
              !Array.isArray(b.ai_fields) ||
              !b.context ||
              typeof b.context !== 'object'
            ) {
              return jsonResponse(res, 400, { error: 'missing_fields' })
            }

            const requestBody = b as unknown as AiRequestBody

            // 503 if no API key
            const key = env.OPENAI_API_KEY
            if (!key) {
              return jsonResponse(res, 503, { error: 'no_key' })
            }

            // Build prompt
            const { system, user } = buildAiPrompt(requestBody)
            const model = pickModel(env.OPENAI_MODEL)

            const cacheKey = createHash('sha256').update(model + '\n' + system + '\n' + user).digest('hex')
            if (responseCache.has(cacheKey)) {
              return jsonResponse(res, 200, { patch: responseCache.get(cacheKey), cached: true })
            }

            // Daily spend cap — checked before every call, persisted across restarts.
            let usage = usageFor(today(), loadUsage())
            if (!withinLimits(usage, limits)) {
              console.log(`[ai] daily cap reached (${usage.requests} requests, ${usage.inputTokens + usage.outputTokens} tokens) — using authored text until tomorrow`)
              return jsonResponse(res, 429, { error: 'daily_cap' })
            }

            // Call OpenAI
            try {
              const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${key}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model,
                  temperature: 0.8,
                  max_tokens: MAX_OUTPUT_TOKENS,
                  response_format: { type: 'json_object' },
                  messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                  ],
                }),
                signal: AbortSignal.timeout(12000),
              })

              if (!oaRes.ok) {
                // Status and OpenAI's short error code only (e.g. invalid_api_key,
                // insufficient_quota, model_not_found). Never the message text:
                // OpenAI's messages can echo a masked key.
                const errBody = (await oaRes.json().catch(() => null)) as any
                const code = typeof errBody?.error?.code === 'string' ? errBody.error.code : null
                return jsonResponse(res, 502, { error: 'upstream_error', status: oaRes.status, code })
              }

              const oaData = (await oaRes.json()) as any
              usage = recordUsage(usage, oaData?.usage?.prompt_tokens ?? 0, oaData?.usage?.completion_tokens ?? 0)
              saveUsage(usage)
              console.log(
                `[ai] ${model} · request ${usage.requests}/${limits.maxRequestsPerDay} today · ` +
                `${(oaData?.usage?.total_tokens ?? 0).toLocaleString()} tokens · ` +
                `today ${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens ≈ $${estimateUsd(usage).toFixed(4)}`,
              )
              const rawContent: string = oaData?.choices?.[0]?.message?.content ?? ''
              const patch = filterAiResponse(rawContent, requestBody.ai_fields)
              responseCache.set(cacheKey, patch)
              return jsonResponse(res, 200, { patch })
            } catch (err) {
              // Never include key or request details in error messages
              const reason = (err as any)?.name === 'TimeoutError' ? 'timeout' : 'network'
              return jsonResponse(res, 502, { error: 'upstream_error', reason })
            }
          })

          req.on('error', () => {
            jsonResponse(res, 400, { error: 'request_error' })
          })
        })
      }
    },
  }
}
