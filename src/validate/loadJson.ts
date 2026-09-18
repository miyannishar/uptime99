import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

export function loadJson<T = unknown>(relPath: string): T {
  const abs = resolve(ROOT, relPath)
  const raw = readFileSync(abs, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch (cause) {
    throw new Error(`Invalid JSON in ${relPath}: ${(cause as Error).message}`, { cause })
  }
}
