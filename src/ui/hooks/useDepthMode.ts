import { useCallback, useEffect, useState } from 'react'
import type { DepthMode } from '../types'

const KEY = 'uptime99.depthMode'

/**
 * Storage access is wrapped because it fails in more places than it looks:
 * absent under SSR and in test environments, and it *throws on access* in a
 * sandboxed iframe and on write in some private-browsing modes. Losing the
 * preference is acceptable; taking the whole UI down with it is not.
 */
function read(): DepthMode {
  try {
    const stored = globalThis.localStorage?.getItem(KEY)
    return stored === 'depth' || stored === 'flat' || stored === 'auto' ? stored : 'depth'
  } catch {
    return 'depth'
  }
}

function persist(mode: DepthMode): void {
  try {
    globalThis.localStorage?.setItem(KEY, mode)
  } catch {
    /* preference is not persistable here; the session still works */
  }
}

/**
 * The DEPTH / FLAT / AUTO preference.
 *
 * The mode is written to `<html data-depth>` and nothing else: every visual
 * difference between the modes is a token override in styles/tokens.css, so no
 * component ever reads this value. That is what guarantees FLAT cannot lose
 * information — there is no code path in which a component decides to render
 * less.
 *
 * AUTO resolves to FLAT behaviour via the `prefers-reduced-motion` media query,
 * also in the stylesheet.
 */
export function useDepthMode(): [DepthMode, (mode: DepthMode) => void] {
  const [mode, setMode] = useState<DepthMode>(read)

  useEffect(() => {
    document.documentElement.dataset.depth = mode
    persist(mode)
  }, [mode])

  const set = useCallback((next: DepthMode) => setMode(next), [])

  return [mode, set]
}
