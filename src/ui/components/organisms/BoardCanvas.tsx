import { useEffect, useRef } from 'react'
import type { BoardNode, LayerDef } from '../../types'
import { EdgeLink, NodeCard } from '../molecules'
import {
  ANCHOR_Y, BAND_W, CARD_W, PAD, useBoardLayout,
} from '../../hooks/useBoardLayout'
import { cx, healthStatus, layerVar } from '../../utils/format'
import s from './BoardCanvas.module.css'

export interface BoardCanvasProps {
  nodes: readonly BoardNode[]
  /** The four on-path layers, already sorted by `layer_index`. */
  requestPathLayers: readonly LayerDef[]
  /** The three layers with `layer_index: null`. */
  offPathLayers: readonly LayerDef[]
  selectedInstanceId?: string | null
  onSelect?: (instanceId: string) => void
  incidentCountByInstance?: Readonly<Record<string, number>>
  saturationKnee?: number
}

/**
 * The board: a graph of draggable nodes.
 *
 * Nodes are absolutely positioned and can be dragged anywhere; drag the
 * background to pan. Link endpoints are pure arithmetic off those positions -
 * there is deliberately no DOM measurement here, which is both simpler and the
 * reason this component can no longer enter a layout/measure feedback loop.
 *
 * The layer bands behind the nodes are GUIDES, not containers. A node's `layer`
 * is fixed in `data/nodes/*.json` and dragging a card out of its band changes
 * nothing - the band is there so the request path stays readable left to right
 * and the off-path shelf stays visibly separate, since those three layers are
 * never in the p95 sum.
 */
export function BoardCanvas({
  nodes,
  requestPathLayers,
  offPathLayers,
  selectedInstanceId,
  onSelect,
  incidentCountByInstance = {},
  saturationKnee = 0.8,
}: BoardCanvasProps) {
  const layout = useBoardLayout(nodes, requestPathLayers)
  const { positions, offPathY, pan, zoom } = layout
  const viewportRef = useRef<HTMLDivElement>(null)

  const byId = new Map(nodes.map((n) => [n.inst.instance_id, n]))

  // Extent of the placed graph, so the pannable surface is big enough to hold it.
  let maxX = PAD + requestPathLayers.length * BAND_W
  let maxY = offPathY + 200
  for (const p of positions.values()) {
    maxX = Math.max(maxX, p.x + CARD_W + PAD)
    maxY = Math.max(maxY, p.y + 160)
  }

  const links = nodes.flatMap((node) => {
    const from = positions.get(node.inst.instance_id)
    if (!from) return []
    return node.edgesOut.flatMap((targetId) => {
      const to = positions.get(targetId)
      const target = byId.get(targetId)
      if (!to || !target) return []
      const touchesSelection =
        !selectedInstanceId ||
        selectedInstanceId === node.inst.instance_id ||
        selectedInstanceId === targetId
      // Leave the source's right edge, enter the target's left edge. When a card
      // has been dragged to the left of its target the curve simply doubles back,
      // which reads correctly as "this dependency points backwards".
      return [
        {
          id: `${node.inst.instance_id}->${targetId}`,
          from: { x: from.x + CARD_W, y: from.y + ANCHOR_Y },
          to: { x: to.x, y: to.y + ANCHOR_Y },
          severed: target.inst.down,
          status: healthStatus(target.inst.health, target.inst.down),
          dimmed: !touchesSelection,
          label: `${node.def.name} to ${target.def.name}`,
        },
      ]
    })
  })

  /**
   * Wheel zoom, attached natively with `passive: false`.
   *
   * React's synthetic wheel handler is registered passively, so calling
   * preventDefault there is ignored and the page scrolls behind the zoom. This has
   * to be a native listener to own the gesture.
   */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      // Normalise across deltaMode (pixels vs lines vs pages) and trackpads.
      const step = Math.max(-0.25, Math.min(0.25, -e.deltaY * 0.0015))
      layout.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [layout.zoomAtPoint])

  const fitToViewport = () => {
    const el = viewportRef.current
    if (!el) return
    layout.fit(el.clientWidth, el.clientHeight, maxX, maxY)
  }

  return (
    <div className={s.root}>
      {/* ---- controls -------------------------------------------------- */}
      <div className={s.controls}>
        <span className={s.hint}>drag nodes · drag background to pan · scroll to zoom</span>
        <button type="button" className={s.ctl} onClick={() => layout.zoomBy(-0.1)} aria-label="Zoom out">
          −
        </button>
        <span className={s.zoom}>{Math.round(zoom * 100)}%</span>
        <button type="button" className={s.ctl} onClick={() => layout.zoomBy(0.1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className={s.ctl} onClick={fitToViewport}>
          fit
        </button>
        <button type="button" className={s.ctl} onClick={layout.reset}>
          reset
        </button>
      </div>

      {/* ---- pannable surface ------------------------------------------ */}
      <div
        ref={viewportRef}
        className={cx(s.viewport, layout.dragging && s.grabbing)}
        onPointerDown={layout.startPan}
      >
        <div
          className={s.world}
          style={{
            width: maxX,
            height: maxY,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* layer bands - guides, not containers */}
          {requestPathLayers.map((layer, i) => (
            <div
              key={layer.id}
              className={s.band}
              style={{
                left: PAD - 18,
                top: PAD - 34,
                width: BAND_W - 24,
                height: offPathY - PAD + 34,
                transform: `translateX(${i * BAND_W}px)`,
                ['--layer' as string]: layerVar(layer.id),
              }}
            >
              <span className={s.bandLabel}>
                {layer.name}
                <span className={s.bandIndex}>{layer.layer_index}</span>
              </span>
            </div>
          ))}

          {/* off-path shelf */}
          <div className={s.shelf} style={{ top: offPathY, width: maxX - PAD * 2 + 36, left: PAD - 18 }}>
            <span className={s.shelfLabel}>
              off the request path · never in the p95 sum ·{' '}
              {offPathLayers.map((l) => l.name).join(' · ')}
            </span>
          </div>

          <svg className={s.links} width={maxX} height={maxY} aria-hidden="true">
            {links.map((link) => (
              <EdgeLink key={link.id} {...link} />
            ))}
          </svg>

          {nodes.map((node) => {
            const p = positions.get(node.inst.instance_id)
            if (!p) return null
            const id = node.inst.instance_id
            return (
              <div
                key={id}
                className={cx(s.slot, layout.dragging === id && s.dragging)}
                style={{ left: p.x, top: p.y }}
                onPointerDown={(e) => layout.startNodeDrag(id, e)}
              >
                <NodeCard
                  node={node}
                  selected={selectedInstanceId === id}
                  // Suppress the click that ends a drag, so moving a card does
                  // not also change the inspector.
                  onSelect={onSelect ? () => !layout.moved && onSelect(id) : undefined}
                  incidentCount={incidentCountByInstance[id] ?? 0}
                  saturationKnee={saturationKnee}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
