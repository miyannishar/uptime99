/* AI text merge — pure module, no side effects, no node:* imports.
   Validates and applies AI-generated text patches onto a minigame instance.
   The answer (`solution`) is never rewritten; only paths listed in the
   format's `ai_fields` array may be updated. */

export type AiPatch = Readonly<Record<string, unknown>>

export interface AiValidation {
  readonly ok: boolean
  readonly reasons: readonly string[]
}

/**
 * Read a field value from an instance by its ai_fields path.
 * Supported paths:
 *   'brief'                  → instance.brief (string)
 *   'reveal'                 → instance.reveal (string)
 *   'given.<key>'            → instance.given[key] (string | string[])
 *   'wrong_outcomes[].shows' → instance.wrong_outcomes[*].shows (string[])
 */
export function readPath(instance: any, path: string): unknown {
  if (path === 'brief') return instance?.brief
  if (path === 'reveal') return instance?.reveal
  if (path.startsWith('given.')) {
    const key = path.slice('given.'.length)
    return instance?.given?.[key]
  }
  if (path === 'wrong_outcomes[].shows') {
    const outcomes: any[] = Array.isArray(instance?.wrong_outcomes)
      ? instance.wrong_outcomes
      : []
    return outcomes.map((wo: any) => wo.shows)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract normalised numbers from a string (commas stripped). */
function extractNumbers(text: string): Set<string> {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? []
  return new Set(matches.map((m) => m.replace(/,/g, '')))
}

/** Validate a single string against the four per-string rules. */
function validateString(original: string, patched: string, label: string): string[] {
  const failures: string[] = []

  if (patched.length < 20) {
    failures.push(`'${label}': too short (${patched.length} chars, min 20)`)
  }
  if (patched.length > 700) {
    failures.push(`'${label}': too long (${patched.length} chars, max 700)`)
  }
  if (patched.includes('{{') || patched.includes('}}')) {
    failures.push(`'${label}': contains unresolved template braces`)
  }
  const origNums = extractNumbers(original)
  const patchedNums = extractNumbers(patched)
  for (const num of origNums) {
    if (!patchedNums.has(num)) {
      failures.push(`'${label}': number ${num} dropped from rewrite`)
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an AI-generated patch against the instance and the format's ai_fields.
 *
 * Rules (spec §#3 Rules 1–4):
 *  1. Unknown keys are reported in `reasons` but do NOT cause failure; they are
 *     dropped by `applyAiPatch`.
 *  2. A known key fails on type mismatch or array-length mismatch.
 *  3. A known key fails if any number in the original is missing from the rewrite.
 *  4. A known key fails if the value contains `{{`/`}}` or is < 20 or > 700 chars.
 *
 * `ok` = no failing known key AND at least one known key is present in the patch.
 */
export function validateAiPatch(
  instance: any,
  aiFields: readonly string[],
  patch: AiPatch,
): AiValidation {
  const reasons: string[] = []
  let knownKeyCount = 0
  let failingKnownKeyCount = 0

  for (const [key, patchValue] of Object.entries(patch)) {
    if (!aiFields.includes(key)) {
      reasons.push(`unknown key '${key}' (will be dropped)`)
      continue
    }

    knownKeyCount++
    const original = readPath(instance, key)

    if (key === 'wrong_outcomes[].shows') {
      // Expect string[]
      if (!Array.isArray(patchValue)) {
        reasons.push(`'${key}': expected array, got ${typeof patchValue}`)
        failingKnownKeyCount++
        continue
      }
      const origArr = original as string[]
      if (patchValue.length !== origArr.length) {
        reasons.push(
          `'${key}': array length mismatch (got ${patchValue.length}, expected ${origArr.length})`,
        )
        failingKnownKeyCount++
        continue
      }
      let elementFailed = false
      for (let i = 0; i < origArr.length; i++) {
        const pv = patchValue[i]
        if (typeof pv !== 'string') {
          reasons.push(`'${key}[${i}]': expected string, got ${typeof pv}`)
          elementFailed = true
          continue
        }
        const failures = validateString(origArr[i] ?? '', pv, `${key}[${i}]`)
        if (failures.length > 0) {
          reasons.push(...failures)
          elementFailed = true
        }
      }
      if (elementFailed) failingKnownKeyCount++
    } else if (Array.isArray(original)) {
      // given.<key> that is a string[] (e.g. given.history)
      if (!Array.isArray(patchValue)) {
        reasons.push(`'${key}': expected array, got ${typeof patchValue}`)
        failingKnownKeyCount++
        continue
      }
      if (patchValue.length !== original.length) {
        reasons.push(
          `'${key}': array length mismatch (got ${patchValue.length}, expected ${original.length})`,
        )
        failingKnownKeyCount++
        continue
      }
      let elementFailed = false
      for (let i = 0; i < original.length; i++) {
        const pv = patchValue[i]
        const ov = original[i]
        if (typeof pv !== 'string') {
          reasons.push(`'${key}[${i}]': expected string, got ${typeof pv}`)
          elementFailed = true
          continue
        }
        const failures = validateString(typeof ov === 'string' ? ov : '', pv, `${key}[${i}]`)
        if (failures.length > 0) {
          reasons.push(...failures)
          elementFailed = true
        }
      }
      if (elementFailed) failingKnownKeyCount++
    } else if (typeof original === 'string') {
      if (typeof patchValue !== 'string') {
        reasons.push(`'${key}': expected string, got ${typeof patchValue}`)
        failingKnownKeyCount++
        continue
      }
      const failures = validateString(original, patchValue, key)
      if (failures.length > 0) {
        reasons.push(...failures)
        failingKnownKeyCount++
      }
    } else if (original === undefined) {
      // Path exists in ai_fields but not in this instance — skip validation
    } else {
      // Unexpected type in original
      reasons.push(`'${key}': cannot validate (original type '${typeof original}' unsupported)`)
      failingKnownKeyCount++
    }
  }

  return {
    ok: knownKeyCount > 0 && failingKnownKeyCount === 0,
    reasons,
  }
}

/**
 * Apply a validated AI patch to a minigame instance.
 * Returns a **new** object; the input is never mutated.
 * Unknown keys (not in `aiFields`) are silently ignored.
 * `solution` is never touched, even if it somehow appears in `aiFields`.
 */
export function applyAiPatch<T>(instance: T, aiFields: readonly string[], patch: AiPatch): T {
  const result: any = { ...(instance as any) }

  for (const [key, patchValue] of Object.entries(patch)) {
    // Drop unknown keys and never touch solution
    if (!aiFields.includes(key)) continue
    if (key === 'solution') continue

    if (key === 'brief') {
      result.brief = patchValue
    } else if (key === 'reveal') {
      result.reveal = patchValue
    } else if (key.startsWith('given.')) {
      const subkey = key.slice('given.'.length)
      result.given = { ...result.given, [subkey]: patchValue }
    } else if (key === 'wrong_outcomes[].shows') {
      const patchArr = patchValue as string[]
      result.wrong_outcomes = (result.wrong_outcomes as any[]).map(
        (wo: any, i: number) => ({ ...wo, shows: patchArr[i] ?? wo.shows }),
      )
    }
  }

  return result as T
}
