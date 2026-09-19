import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { BoardNode, LayerDef } from '../../types'
import { EdgeLink, NodeCard } from '../molecules'
import type { Point } from '../molecules'
import { healthStatus, layerVar } from '../../utils/format'
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

interface Link {
  id: string
  from: Point
  to: Point
  severed: boolean
  status: ReturnType<typeof healthStatus>
  dimmed: boolean
  label: string
}

/**
 * The board.
 *
 * Layout is a column per request-path layer in `layer_index` order — edge →
 * ingress → compute → data — which makes a request's journey left-to-right
 * reading order. The three off-path layers sit in a tray below, separated by a
 * rule, because they are never in the p95 sum and grouping them with the path
 * would imply otherwise.
 *
 * Links are drawn in an SVG overlay from MEASURED card positions rather than
 * computed coordinates, so the graph stays correct when cards reflow, text
 * wraps, or the container resizes.
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
  const hostRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const [links, setLinks] = useState<Link[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  const byId = new Map(nodes.map((n) => [n.inst.instance_id, n]))

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }, [])

  const measure = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const base = host.getBoundingClientRect()
    setSize({ w: base.width, h: base.height })

    const next: Link[] = []
    for (const node of nodes) {
      const fromEl = cardRefs.current.get(node.inst.instance_id)
      if (!fromEl) continue
      const a = fromEl.getBoundingClientRect()

      for (const targetId of node.edgesOut) {
        const toEl = cardRefs.current.get(targetId)
        const target = byId.get(targetId)
        if (!toEl || !target) continue
        const b = toEl.getBoundingClientRect()

        const touchesSelection =
          !selectedInstanceId ||
          selectedInstanceId === node.inst.instance_id ||
          selectedInstanceId === targetId

        next.push({
          id: `${node.inst.instance_id}->${targetId}`,
          from: { x: a.right - base.left, y: a.top - base.top + a.height / 2 },
          to: { x: b.left - base.left, y: b.top - base.top + b.height / 2 },
          // A down target means no traffic reaches it at all.
          severed: target.inst.down,
          status: healthStatus(target.inst.health, target.inst.down),
          dimmed: !touchesSelection,
          label: `${node.def.name} to ${target.def.name}`,
        })
      }
    }
    setLinks(next)
  }, [nodes, byId, selectedInstanceId])

  useLayoutEffect(() => {
    measure()
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    for (const el of cardRefs.current.values()) ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const renderColumn = (layer: LayerDef, compact = false) => {
    const inLayer = nodes.filter((n) => n.layer.id === layer.id)
    return (
      <div className={s.column} key={layer.id}>
        <div className={s.layerHead} style={{ ['--layer' as string]: layerVar(layer.id) }}>
          <span className={s.layerName}>{layer.name}</span>
          {layer.layer_index !== null && <span className={s.layerIndex}>{layer.layer_index}</span>}
        </div>
        <div className={s.stack}>
          {inLayer.length === 0 && <div className={s.empty}>empty</div>}
          {inLayer.map((node) => (
            <div key={node.inst.instance_id} ref={(el) => register(node.inst.instance_id, el)}>
              <NodeCard
                node={node}
                compact={compact}
                selected={selectedInstanceId === node.inst.instance_id}
                onSelect={onSelect}
                incidentCount={incidentCountByInstance[node.inst.instance_id] ?? 0}
                saturationKnee={saturationKnee}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={s.root} ref={hostRef}>
      <svg className={s.links} width={size.w} height={size.h} aria-hidden="true">
        {links.map((link) => (
          <EdgeLink key={link.id} {...link} />
        ))}
      </svg>

      <div className={s.path}>{requestPathLayers.map((l) => renderColumn(l))}</div>

      <div className={s.trayRule}>
        <span className={s.trayLabel}>off the request path · never in the p95 sum</span>
      </div>

      <div className={s.tray}>{offPathLayers.map((l) => renderColumn(l, true))}</div>
    </div>
  )
}
