import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import { useResizableLayout } from '../../hooks/useResizableLayout'
import s from './AppShell.module.css'

export interface AppShellProps {
  header: ReactNode
  left?: ReactNode
  main: ReactNode
  right?: ReactNode
  dock?: ReactNode
  overlay?: ReactNode
  spotlightRegion?: 'header' | 'left' | 'main' | 'right' | 'dock' | null
}

export function AppShell({ header, left, main, right, dock, overlay, spotlightRegion }: AppShellProps) {
  const { layout, startDrag } = useResizableLayout()

  const dim = (r: 'header' | 'left' | 'main' | 'right' | 'dock') =>
    spotlightRegion != null && spotlightRegion !== r ? s.dimmed : ''
  const lit = (r: 'header' | 'left' | 'main' | 'right' | 'dock') =>
    spotlightRegion === r ? s.spotlight : ''

  const cols = left && right
    ? `${layout.leftW}px 6px minmax(0,1fr) 6px ${layout.rightW}px`
    : left
    ? `${layout.leftW}px 6px minmax(0,1fr)`
    : right
    ? `minmax(0,1fr) 6px ${layout.rightW}px`
    : 'minmax(0,1fr)'

  const rows = dock
    ? `auto minmax(0,1fr) 8px ${layout.dockH}px`
    : 'auto minmax(0,1fr)'

  return (
    <div
      className={cx(s.root, left && s.withLeft, right && s.withRight, dock && s.withDock)}
      style={{ gridTemplateColumns: cols, gridTemplateRows: rows } as React.CSSProperties}
    >
      <div className={cx(s.header, dim('header'), lit('header'))}>{header}</div>

      {left && (
        <>
          <div className={cx(s.left, dim('left'), lit('left'))}>{left}</div>
          <div className={s.dividerV} onMouseDown={e => startDrag('left', e)} title="Drag to resize" />
        </>
      )}

      <main className={cx(s.main, dim('main'), lit('main'))}>{main}</main>

      {right && (
        <>
          <div className={s.dividerV} onMouseDown={e => startDrag('right', e)} title="Drag to resize" />
          <div className={cx(s.right, dim('right'), lit('right'))}>{right}</div>
        </>
      )}

      {dock && (
        <>
          {/* Drag up/down to resize dock height */}
          <div
            className={s.dividerH}
            onMouseDown={e => startDrag('dock', e)}
            title="Drag up/down to resize"
          />
          <div className={cx(s.dock, dim('dock'), lit('dock'))}>{dock}</div>
        </>
      )}

      {overlay}
    </div>
  )
}
