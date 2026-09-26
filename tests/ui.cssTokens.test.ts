import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// A CSS custom property that tokens.css does not define resolves to nothing:
// borders vanish and chips render as bare text, with no error anywhere.
const tokens = readFileSync('src/ui/styles/tokens.css', 'utf8')
const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))

function filesEnding(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesEnding(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [])
}
// Custom properties a component sets inline (style={{ '--layer': … }}) are defined at runtime.
const inline = new Set(filesEnding('src/ui', '.tsx').flatMap((f) =>
  [...readFileSync(f, 'utf8').matchAll(/['"](--[a-z0-9-]+)['"]/g)].map((m) => m[1])))

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.module.css') ? [join(dir, e.name)] : [])
}

describe('CSS modules use only design tokens that exist', () => {
  for (const f of cssFiles('src/ui/components')) {
    it(f, () => {
      const css = readFileSync(f, 'utf8')
      const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
      // var(--x, fallback) degrades gracefully; only a bare var(--x) renders as nothing.
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1])
      const missing = [...new Set(used.filter((v) => !defined.has(v) && !local.has(v) && !inline.has(v)))]
      expect(missing).toEqual([])
    })
  }
})

describe('TSX inline styles use only design tokens that exist', () => {
  for (const f of filesEnding('src/ui', '.tsx')) {
    const src = readFileSync(f, 'utf8')
    const used = [...src.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1])
    if (used.length === 0) continue
    it(f, () => {
      expect([...new Set(used.filter((v) => !defined.has(v) && !inline.has(v)))]).toEqual([])
    })
  }
})
