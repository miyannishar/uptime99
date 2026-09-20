import { useCallback, useMemo, useRef, useState } from 'react'
import type { BoardNode, LayerDef } from '../types'

export interface Point {
  x: number
  y: number
}

/* Geometry the canvas and the link maths both depend on. */
export const CARD_W = 116
/** Vertical distance between auto-placed cards in the same layer. */
export const CARD_PITCH = 104
/** Horizontal distance between layer bands. */
export const BAND_W = 210
/**
 * Where a link attaches, measured down from a card's top edge - level with the
 * card's title row. A fixed offset rather than the card's centre, because cards
 * vary in height with their tag count and a centre anchor would make links
 * twitch as tags come and go.
 */
export const ANCHOR_Y = 22
export const PAD = 44

export interface BoardLayout {
  positions: ReadonlyMap<string, Point>
  /** y of the rule separating on-path bands from the off-path shelf. */
  offPathY: number
  pan: Point
  zoom: number
  dragging: string | null
  /** True when the pointer moved far enough to count as a drag, not a click. */
  moved: boolean
  startNodeDrag: (id: string, e: React.PointerEvent) => void
  startPan: (e: React.PointerEvent) => void
  zoomBy: (delta: number) => void
  /** Zoom keeping the world point under (localX, localY) fixed on screen. */
  zoomAtPoint: (localX: number, localY: number, delta: number) => void
  /** Scale and centre so the whole graph fits the viewport. */
  fit: (viewW: number, viewH: number, contentW: number, contentH: number) => void
  /** Re-run auto-layout and clear pan and zoom. */
  reset: () => void
}

const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * Free-form node positions for the board graph.
 *
 * Auto-places every node inside its layer's band on first render so the board
 * opens tidy, then lets the player drag anything anywhere. Positions are
 * COSMETIC ONLY: a node's `layer` comes from `data/nodes/*.json` and dragging a
 * card out of its band changes nothing about how it behaves. That matters because
 * `data/layers.json` is the single source of truth for what is on the request
 * path, and a draggable canvas must not quietly become a second one.
 */
export function useBoardLayout(
  nodes: readonly BoardNode[],
  requestPathLayers: readonly LayerDef[],
): BoardLayout {
  const [custom, setCustom] = useState<Map<string, Point>>(new Map())
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)
  const origin = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  /** Tidy default: bands left to right for the request path, a shelf underneath. */
  const auto = useMemo(() => {
    const out = new Map<string, Point>()
    const bandIndex = new Map(requestPathLayers.map((l, i) => [l.id, i]))
    const seen = new Map<number, number>()

    let deepest = 0
    for (const node of nodes) {
      const band = bandIndex.get(node.layer.id)
      if (band === undefined) continue
      const row = seen.get(band) ?? 0
      seen.set(band, row + 1)
      deepest = Math.max(deepest, row + 1)
      out.set(node.inst.instance_id, {
        x: PAD + band * BAND_W,
        y: PAD + 30 + row * CARD_PITCH,
      })
    }

    const shelfY = PAD + 30 + deepest * CARD_PITCH + 52
    let col = 0
    for (const node of nodes) {
      if (bandIndex.has(node.layer.id)) continue
      out.set(node.inst.instance_id, {
        x: PAD + col * (CARD_W + 26),
        y: shelfY + 34,
      })
      col += 1
    }

    return { positions: out, offPathY: shelfY }
  }, [nodes, requestPathLayers])

  const positions = useMemo(() => {
    if (custom.size === 0) return auto.positions
    const merged = new Map(auto.positions)
    for (const [id, p] of custom) merged.set(id, p)
    return merged
  }, [auto.positions, custom])

  const startNodeDrag = useCallback(
    (id: string, e: React.PointerEvent) => {
      const from = positions.get(id)
      if (!from) return
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      origin.current = { px: e.clientX, py: e.clientY, ox: from.x, oy: from.y }
      setDragging(id)
      setMoved(false)

      const onMove = (ev: PointerEvent) => {
        const o = origin.current
        if (!o) return
        const dx = (ev.clientX - o.px) / zoom
        const dy = (ev.clientY - o.py) / zoom
        // 3px of slop so a click with a shaky hand still selects.
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setMoved(true)
        setCustom((prev) => {
          const next = new Map(prev)
          next.set(id, { x: o.ox + dx, y: o.oy + dy })
          return next
        })
      }
      const onUp = () => {
        origin.current = null
        setDragging(null)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [positions, zoom],
  )

  const startPan = useCallback(
    (e: React.PointerEvent) => {
      const start = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y }
      const onMove = (ev: PointerEvent) => {
        setPan({ x: start.ox + (ev.clientX - start.px), y: start.oy + (ev.clientY - start.py) })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [pan],
  )

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => clampZoom(Math.round((z + delta) * 20) / 20))
  }, [])

  /**
   * Cursor-anchored zoom. Without this the world scales about its own origin and
   * whatever you were looking at slides off screen, which makes wheel zoom feel
   * broken even though the scale is correct.
   */
  const zoomAtPoint = useCallback((localX: number, localY: number, delta: number) => {
    setZoom((z) => {
      const next = clampZoom(z * (1 + delta))
      if (next === z) return z
      setPan((p) => ({
        x: localX - ((localX - p.x) / z) * next,
        y: localY - ((localY - p.y) / z) * next,
      }))
      return next
    })
  }, [])

  const fit = useCallback((viewW: number, viewH: number, contentW: number, contentH: number) => {
    if (viewW <= 0 || viewH <= 0 || contentW <= 0 || contentH <= 0) return
    const next = clampZoom(Math.min(viewW / contentW, viewH / contentH) * 0.94)
    setZoom(next)
    setPan({
      x: (viewW - contentW * next) / 2,
      y: Math.max(0, (viewH - contentH * next) / 2),
    })
  }, [])

  const reset = useCallback(() => {
    setCustom(new Map())
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }, [])

  return {
    positions,
    offPathY: auto.offPathY,
    pan,
    zoom,
    dragging,
    moved,
    startNodeDrag,
    startPan,
    zoomBy,
    zoomAtPoint,
    fit,
    reset,
  }
}
