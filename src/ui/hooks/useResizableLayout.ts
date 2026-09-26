import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'uptime99:layout'
const MIN_COL = 180
const MAX_COL = 520
const MIN_DOCK = 80
const MAX_DOCK = 320

export type DockPanel = 'provisioning' | 'cooldowns' | 'ledger'

interface Layout {
  leftW: number
  rightW: number
  dockH: number
  dockOrder: DockPanel[]
}

const DEFAULT: Layout = {
  leftW: 400,
  rightW: 340,
  dockH: 140,
  dockOrder: ['provisioning', 'cooldowns', 'ledger'],
}

function load(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT
}

function save(l: Layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(l)) } catch {}
}

export function useResizableLayout() {
  const [layout, setLayout] = useState<Layout>(load)

  // Column / dock-height drag
  const dragging = useRef<'left' | 'right' | 'dock' | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const startVal = useRef(0)

  // Sub-panel drag-to-reorder
  const draggingPanel = useRef<DockPanel | null>(null)
  const dragPanelStartX = useRef(0)

  const onMouseMove = useCallback((e: MouseEvent) => {
    // Column / dock resize
    if (dragging.current === 'left') {
      const dx = e.clientX - startX.current
      setLayout(l => ({ ...l, leftW: Math.min(MAX_COL, Math.max(MIN_COL, startVal.current + dx)) }))
    } else if (dragging.current === 'right') {
      const dx = startX.current - e.clientX
      setLayout(l => ({ ...l, rightW: Math.min(MAX_COL, Math.max(MIN_COL, startVal.current + dx)) }))
    } else if (dragging.current === 'dock') {
      // Drag up = taller dock
      const dy = startY.current - e.clientY
      setLayout(l => ({ ...l, dockH: Math.min(MAX_DOCK, Math.max(MIN_DOCK, startVal.current + dy)) }))
    }

    // Sub-panel reorder: swap when mouse moves > 80px from drag start
    if (draggingPanel.current) {
      const dx = e.clientX - dragPanelStartX.current
      if (Math.abs(dx) > 80) {
        setLayout(l => {
          const order = [...l.dockOrder]
          const idx = order.indexOf(draggingPanel.current!)
          if (idx === -1) return l
          const target = dx > 0 ? idx + 1 : idx - 1
          if (target < 0 || target >= order.length) return l
          ;[order[idx], order[target]] = [order[target], order[idx]]
          dragPanelStartX.current = e.clientX  // reset so next 80px triggers another swap
          return { ...l, dockOrder: order }
        })
      }
    }
  }, [])

  const onMouseUp = useCallback(() => {
    if (dragging.current || draggingPanel.current) {
      setLayout(l => { save(l); return l })
    }
    dragging.current = null
    draggingPanel.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  /** Start resizing a column or the dock height */
  const startDrag = useCallback((type: 'left' | 'right' | 'dock', e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = type
    startX.current = e.clientX
    startY.current = e.clientY
    startVal.current = type === 'left' ? layout.leftW
      : type === 'right' ? layout.rightW
      : layout.dockH
    document.body.style.cursor = type === 'dock' ? 'ns-resize' : 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [layout])

  /** Start dragging a dock sub-panel to reorder it */
  const startPanelDrag = useCallback((panel: DockPanel, e: React.MouseEvent) => {
    e.preventDefault()
    draggingPanel.current = panel
    dragPanelStartX.current = e.clientX
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [])

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT)
    save(DEFAULT)
  }, [])

  return { layout, startDrag, startPanelDrag, resetLayout }
}
