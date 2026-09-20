/* A hand-written recursive-descent evaluator for the formula strings in
   data/metrics.json. eval and new Function are prohibited: these strings are
   authored data, and an evaluator that can reach the runtime is an injection
   surface. Unknown identifiers throw — a formula that silently reads zero
   produces a plausible wrong number, which is worse than a crash. */

export type FormulaValue = number | number[]

export interface FormulaScope {
  /** Bare identifiers: metric values, economy constants, derived terms. */
  readonly scalars: Readonly<Record<string, number>>
  /** Dotted identifiers, e.g. `path.base_latency_ms`. One element per node. */
  readonly vectors: Readonly<Record<string, readonly number[]>>
}

export const ALLOWED_FUNCTIONS = [
  'sum', 'min', 'max', 'clamp', 'saturation_curve', 'decay',
] as const

type Tok =
  | { k: 'num'; v: number } | { k: 'id'; v: string }
  | { k: 'op'; v: '+' | '-' | '*' | '/' }
  | { k: 'lp' } | { k: 'rp' } | { k: 'comma' }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  const re = /\s*(?:([0-9]+(?:\.[0-9]+)?)|([A-Za-z_][A-Za-z0-9_.]*)|([+\-*/])|(\()|(\))|(,))/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (m.index !== at) break
    at = re.lastIndex
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) })
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] })
    else if (m[3] !== undefined) out.push({ k: 'op', v: m[3] as '+' })
    else if (m[4] !== undefined) out.push({ k: 'lp' })
    else if (m[5] !== undefined) out.push({ k: 'rp' })
    else out.push({ k: 'comma' })
  }
  if (at !== src.length) {
    throw new Error(`formula: unexpected character at ${at} in '${src}'`)
  }
  return out
}

function broadcast(
  a: FormulaValue, b: FormulaValue, f: (x: number, y: number) => number,
): FormulaValue {
  const aArr = Array.isArray(a), bArr = Array.isArray(b)
  if (!aArr && !bArr) return f(a as number, b as number)
  if (aArr && bArr) {
    const x = a as number[], y = b as number[]
    if (x.length !== y.length) {
      throw new Error(`formula: cannot combine vectors of length ${x.length} and ${y.length}`)
    }
    return x.map((v, i) => f(v, y[i]))
  }
  if (aArr) return (a as number[]).map((v) => f(v, b as number))
  return (b as number[]).map((v) => f(a as number, v))
}

function asNumber(v: FormulaValue, what: string): number {
  if (Array.isArray(v)) throw new Error(`formula: ${what} requires a number, got a vector`)
  return v
}

function flat(args: FormulaValue[]): number[] {
  return args.flatMap((a) => (Array.isArray(a) ? a : [a]))
}

function callFunction(name: string, args: FormulaValue[], scope: FormulaScope): FormulaValue {
  const knee = scope.scalars.saturation_knee
  const exponent = scope.scalars.saturation_exponent

  switch (name) {
    case 'sum':
      return flat(args).reduce((a, b) => a + b, 0)
    case 'min': {
      const vals = flat(args)
      return vals.length ? Math.min(...vals) : 0
    }
    case 'max': {
      const vals = flat(args)
      return vals.length ? Math.max(...vals) : 0
    }
    case 'clamp': {
      if (args.length !== 3) throw new Error('formula: clamp expects 3 arguments')
      const lo = asNumber(args[1], 'clamp lower bound')
      const hi = asNumber(args[2], 'clamp upper bound')
      return broadcast(args[0], 0, (x) => Math.min(hi, Math.max(lo, x)))
    }
    case 'saturation_curve': {
      if (args.length !== 1) throw new Error('formula: saturation_curve expects 1 argument')
      if (knee === undefined || exponent === undefined) {
        throw new Error('formula: saturation_curve needs saturation_knee and saturation_exponent in scope')
      }
      // Polynomial, NOT a reciprocal of (1 - u): the reciprocal form gives
      // x296 at 97% utilisation and x8,000,000 at 100%, which is unusable.
      return broadcast(args[0], 0, (u) =>
        1 + Math.pow(Math.max(0, u - knee) / (1 - knee), exponent))
    }
    case 'decay': {
      if (args.length !== 2) throw new Error('formula: decay expects 2 arguments')
      const r = asNumber(args[0], 'decay value')
      const severity = asNumber(args[1], 'decay severity')
      // Missing constants must throw, consistent with saturation_curve above. (M4)
      if (scope.scalars.reputation_decay_per_tick === undefined) {
        throw new Error('formula: decay needs reputation_decay_per_tick in scope')
      }
      if (scope.scalars.reputation_recovery_per_tick === undefined) {
        throw new Error('formula: decay needs reputation_recovery_per_tick in scope')
      }
      const down = scope.scalars.reputation_decay_per_tick
      const up = scope.scalars.reputation_recovery_per_tick
      return severity > 0 ? r - down * severity : r + up
    }
    default:
      throw new Error(`formula: unknown function '${name}'`)
  }
}

export function evaluateFormula(src: string, scope: FormulaScope): number {
  const toks = tokenize(src)
  let i = 0

  const peek = () => toks[i]
  const eat = (k: Tok['k']) => {
    const t = toks[i]
    if (!t || t.k !== k) throw new Error(`formula: expected ${k} at token ${i} in '${src}'`)
    i += 1
    return t
  }

  function primary(): FormulaValue {
    const t = peek()
    if (!t) throw new Error(`formula: unexpected end of '${src}'`)
    if (t.k === 'num') { i += 1; return t.v }
    if (t.k === 'lp') { i += 1; const v = expr(); eat('rp'); return v }
    if (t.k === 'op' && t.v === '-') { i += 1; return broadcast(0, unary(), (a, b) => a - b) }
    if (t.k === 'id') {
      i += 1
      if (peek()?.k === 'lp') {
        if (!(ALLOWED_FUNCTIONS as readonly string[]).includes(t.v)) {
          throw new Error(`formula: unknown function '${t.v}'`)
        }
        eat('lp')
        const args: FormulaValue[] = []
        if (peek()?.k !== 'rp') {
          args.push(expr())
          while (peek()?.k === 'comma') { i += 1; args.push(expr()) }
        }
        eat('rp')
        return callFunction(t.v, args, scope)
      }
      if (t.v.includes('.')) {
        if (!Object.prototype.hasOwnProperty.call(scope.vectors, t.v)) {
          throw new Error(`formula: unknown vector '${t.v}'`)
        }
        return [...scope.vectors[t.v]]
      }
      if (!Object.prototype.hasOwnProperty.call(scope.scalars, t.v)) {
        throw new Error(`formula: unknown identifier '${t.v}'`)
      }
      return scope.scalars[t.v]
    }
    throw new Error(`formula: unexpected token at ${i} in '${src}'`)
  }

  function unary(): FormulaValue {
    const t = peek()
    if (t && t.k === 'op' && t.v === '-') { i += 1; return broadcast(0, unary(), (a, b) => a - b) }
    return primary()
  }

  function term(): FormulaValue {
    let v = unary()
    for (;;) {
      const t = peek()
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/')) {
        i += 1
        const rhs = unary()
        v = t.v === '*'
          ? broadcast(v, rhs, (a, b) => a * b)
          : broadcast(v, rhs, (a, b) => a / b)
      } else return v
    }
  }

  function expr(): FormulaValue {
    let v = term()
    for (;;) {
      const t = peek()
      if (t && t.k === 'op' && (t.v === '+' || t.v === '-')) {
        i += 1
        const rhs = term()
        v = t.v === '+'
          ? broadcast(v, rhs, (a, b) => a + b)
          : broadcast(v, rhs, (a, b) => a - b)
      } else return v
    }
  }

  const result = expr()
  if (i !== toks.length) throw new Error(`formula: trailing tokens in '${src}'`)
  if (Array.isArray(result)) {
    throw new Error(`formula: '${src}' produced a vector; a metric must reduce to a single number`)
  }
  return result
}
