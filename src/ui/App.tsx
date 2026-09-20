import { useState, useEffect, useRef } from 'react'
import { useDepthMode } from './hooks/useDepthMode'
import { DepthToggle } from './components/molecules'
import { DebriefPanel } from './components/organisms'
import { RunPreview } from './pages/RunPreview'
import { DesignPreview } from './pages/DesignPreview'
import { adaptScenarios, adaptDebriefSummary } from './adapt'
import { debriefSummary } from '@engine/summary'
import { engineCatalog } from './data/catalog'
import { useGameState } from './hooks/useGameState'
import { sfx } from './hooks/useAudio'
import s from './App.module.css'

/**
 * The game: starts directly in Level 1. A scenario picker lives in the nav.
 * No separate "select a scenario" screen - jump straight in.
 */
export function App() {
  const [depthMode, setDepthMode] = useDepthMode()
  const [scenarioId, setScenarioId] = useState('slice-oom-kill')
  const [_completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [gameKey, setGameKey] = useState(0)   // bump to hard-reset the game
  // Fix C: earned stars per scenario, persisted to localStorage
  const [earnedStars, setEarnedStars] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('uptime99:stars') ?? '{}') } catch { return {} }
  })

  const handleComplete = (id: string) => {
    setCompletedIds(prev => { const n = new Set(prev); n.add(id); return n })
  }

  const switchScenario = (id: string) => {
    setScenarioId(id)
    setGameKey(k => k + 1)   // force a fresh useGameState
  }

  const handleEarnedStars = (scenId: string, stars: number) => {
    setEarnedStars(prev => {
      const current = prev[scenId] ?? 0
      if (stars <= current) return prev
      const next = { ...prev, [scenId]: stars }
      try { localStorage.setItem('uptime99:stars', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const scenarios = adaptScenarios(engineCatalog, earnedStars, new Set(engineCatalog.scenarios.map((sc: any) => sc.id)))

  return (
    <div className={s.root}>
      <nav className={s.nav}>
        <span className={s.brand}>uptime99</span>

        {/* Scenario / level switcher */}
        <select
          className={s.levelPicker}
          value={scenarioId}
          onChange={e => switchScenario(e.target.value)}
          title="Switch scenario"
        >
          {scenarios.map(sc => (
            <option key={sc.id} value={sc.id}>
              {sc.locked ? '🔒 ' : ''}{sc.name}
            </option>
          ))}
        </select>

        <span className={s.spacer} />
        <DepthToggle mode={depthMode} onChange={setDepthMode} includeAuto />
      </nav>

      <div className={s.body}>
        <GameApp
          key={`${scenarioId}-${gameKey}`}
          scenarioId={scenarioId}
          depthMode={depthMode}
          setDepthMode={setDepthMode}
          onComplete={handleComplete}
          onRetry={() => setGameKey(k => k + 1)}
          onSwitchScenario={switchScenario}
          onEarnedStars={handleEarnedStars}
        />
      </div>
    </div>
  )
}

interface GameAppProps {
  scenarioId: string
  depthMode: ReturnType<typeof useDepthMode>[0]
  setDepthMode: ReturnType<typeof useDepthMode>[1]
  onComplete: (id: string) => void
  onRetry: () => void
  onSwitchScenario: (id: string) => void
  onEarnedStars: (scenarioId: string, stars: number) => void
}

function GameApp({ scenarioId, depthMode, setDepthMode, onComplete, onRetry, onSwitchScenario, onEarnedStars }: GameAppProps) {
  const game = useGameState(scenarioId)
  const { state, phase, metrics } = game

  // Auto-start: skip the design phase entirely for preset boards.
  // All current scenarios have an authored board - there is nothing to configure
  // in the design phase before running. startGame is idempotent (no-ops if already run).
  useEffect(() => { game.startGame() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Play session-end sound once when transitioning to debrief
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'debrief' && phase === 'debrief') sfx.sessionEnd()
    prevPhaseRef.current = phase
  }, [phase])

  if (phase === 'debrief') {
    const summary = debriefSummary(state, engineCatalog)
    const adapted = adaptDebriefSummary(summary, metrics.map(m => ({
      id: m.def.id, value: m.value, previous: m.previous,
      series: m.series, status: m.status,
    } as any)))
    // Fix C: compute stars from debrief summary
    const stars = summary.cleared
      ? summary.final_reputation >= 70 ? 3
        : summary.final_reputation >= 40 ? 2
        : 1
      : 0
    const starDisplay = '★'.repeat(stars) + '☆'.repeat(3 - stars)
    return (
      <div className={s.debriefWrap}>
        <div style={{ textAlign: 'center', fontSize: 32, padding: '16px 0 0', letterSpacing: 4, color: stars > 0 ? '#fbbf24' : 'var(--txt-faint)' }}>
          {starDisplay}
        </div>
        <DebriefPanel
          summary={adapted as any}
          onRetry={() => { onRetry() }}
          onContinue={() => {
            onComplete(scenarioId)
            onEarnedStars(scenarioId, stars)
            // Advance to the next scenario if one is unlocked
            const allSc = adaptScenarios(engineCatalog, {}, new Set(engineCatalog.scenarios.map((sc: any) => sc.id)))
            const next = allSc.find(sc =>
              (sc as any).unlocked_by?.includes(scenarioId) ||
              engineCatalog.scenarios.find((s: any) => s.id === sc.id && s.unlocked_by?.includes(scenarioId))
            )
            if (next && !next.locked) onSwitchScenario(next.id)
          }}
        />
      </div>
    )
  }

  if (phase === 'design') {
    return <DesignPreview depthMode={depthMode} onDepthChange={setDepthMode} game={game} />
  }

  return (
    <RunPreview
      depthMode={depthMode}
      onDepthChange={setDepthMode}
      game={game}
      onQuit={scenarioId === 'free-play' ? onRetry : undefined}
      showTutorial={scenarioId === 'slice-oom-kill'}
      onTutorialComplete={() => onSwitchScenario('free-play')}
    />
  )
}
