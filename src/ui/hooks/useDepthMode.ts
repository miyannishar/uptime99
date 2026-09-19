import { useCallback, useEffect, useState } from 'react'
import type { DepthMode } from '../types'

const KEY = 'uptime99.depthMode'

function read(): DepthMode {
  const stored = localStorage.getItem(KEY)
  return stored === 'depth' || stored === 'flat' || stored === 'auto' ? stored : 'depth'
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
  const [mode, setMode] = useState<DepthMode>(() =>
    typeof localStorage === 'undefined' ? 'depth' : read(),
  )

  useEffect(() => {
    document.documentElement.dataset.depth = mode
    localStorage.setItem(KEY, mode)
  }, [mode])

  const set = useCallback((next: DepthMode) => setMode(next), [])

  return [mode, set]
}
