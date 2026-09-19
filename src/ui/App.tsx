import { useState } from 'react'
import { useDepthMode } from './hooks/useDepthMode'
import { DepthToggle } from './components/molecules'
import { Gallery } from './pages/Gallery'
import { RunPreview } from './pages/RunPreview'
import { DesignPreview } from './pages/DesignPreview'
import { MinigamePreview } from './pages/MinigamePreview'
import { OutcomePreview } from './pages/OutcomePreview'
import { cx } from './utils/format'
import s from './App.module.css'

type View = 'run' | 'design' | 'minigames' | 'outcome' | 'library'

const VIEWS: { id: View; label: string; hint: string; full: boolean }[] = [
  { id: 'run', label: 'Run phase', hint: 'Board, inspector, incidents, ⌘K', full: true },
  { id: 'design', label: 'Design phase', hint: 'Catalog, projection, commit gate', full: true },
  { id: 'minigames', label: 'Minigames', hint: 'All five interaction formats', full: false },
  { id: 'outcome', label: 'Scenarios & debrief', hint: 'Entry and exit screens', full: false },
  { id: 'library', label: 'Library', hint: 'Every atom and molecule', full: false },
]

export function App() {
  const [depthMode, setDepthMode] = useDepthMode()
  const [view, setView] = useState<View>('run')
  const active = VIEWS.find((v) => v.id === view) ?? VIEWS[0]

  return (
    <div className={cx(s.root, active.full && s.full)}>
      <nav className={s.nav}>
        <span className={s.brand}>uptime99</span>
        <span className={s.tag}>UI</span>

        <div className={s.tabs}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.hint}
              className={cx(s.tab, v.id === view && s.tabOn)}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <span className={s.spacer} />
        <span className={s.hint}>{active.hint}</span>
        <DepthToggle mode={depthMode} onChange={setDepthMode} includeAuto />
      </nav>

      <div className={s.body}>
        {view === 'run' && <RunPreview depthMode={depthMode} onDepthChange={setDepthMode} />}
        {view === 'design' && <DesignPreview depthMode={depthMode} onDepthChange={setDepthMode} />}
        {view === 'minigames' && (
          <div className={s.padded}>
            <MinigamePreview />
          </div>
        )}
        {view === 'outcome' && (
          <div className={s.padded}>
            <OutcomePreview />
          </div>
        )}
        {view === 'library' && <Gallery />}
      </div>
    </div>
  )
}
