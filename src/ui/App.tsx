import { useState } from 'react'
import { useDepthMode } from './hooks/useDepthMode'
import { DepthToggle } from './components/molecules'
import { DebriefPanel, ScenarioSelect } from './components/organisms'
import { RunPreview } from './pages/RunPreview'
import { DesignPreview } from './pages/DesignPreview'
import { cx } from './utils/format'
import { adaptScenarios, adaptDebriefSummary } from './adapt'
import { debriefSummary } from '@engine/summary'
import { engineCatalog } from './data/catalog'
import { useGameState } from './hooks/useGameState'
import s from './App.module.css'

const scenarios = adaptScenarios()

/**
 * The real game: scenario select → design → run → debrief.
 * The engine drives phase transitions; this component routes to the right screen.
 */
export function App() {
  const [depthMode, setDepthMode] = useDepthMode()
  const [scenarioId, setScenarioId] = useState<string | null>(null)

  if (!scenarioId) {
    return (
      <div className={s.root}>
        <nav className={s.nav}>
          <span className={s.brand}>uptime99</span>
          <span className={s.spacer} />
          <DepthToggle mode={depthMode} onChange={setDepthMode} includeAuto />
        </nav>
        <div className={cx(s.body, s.padded)}>
          <ScenarioSelect scenarios={scenarios} onPick={setScenarioId} />
        </div>
      </div>
    )
  }

  return (
    <GameApp
      key={scenarioId}
      scenarioId={scenarioId}
      depthMode={depthMode}
      setDepthMode={setDepthMode}
      onBack={() => setScenarioId(null)}
    />
  )
}

interface GameAppProps {
  scenarioId: string
  depthMode: ReturnType<typeof useDepthMode>[0]
  setDepthMode: ReturnType<typeof useDepthMode>[1]
  onBack: () => void
}

function GameApp({ scenarioId, depthMode, setDepthMode, onBack }: GameAppProps) {
  const game = useGameState(scenarioId)
  const { state, phase } = game

  if (phase === 'debrief') {
    const summary = debriefSummary(state, engineCatalog)
    const adapted = adaptDebriefSummary(summary)
    return (
      <div className={s.root}>
        <nav className={s.nav}>
          <span className={s.brand}>uptime99</span>
          <span className={s.spacer} />
          <DepthToggle mode={depthMode} onChange={setDepthMode} includeAuto />
        </nav>
        <div className={cx(s.body, s.padded)}>
          <DebriefPanel
            summary={adapted as any}
            onRetry={game.reset}
            onContinue={onBack}
          />
        </div>
      </div>
    )
  }

  if (phase === 'design') {
    return (
      <DesignPreview
        depthMode={depthMode}
        onDepthChange={setDepthMode}
        game={game}
      />
    )
  }

  return (
    <RunPreview
      depthMode={depthMode}
      onDepthChange={setDepthMode}
      game={game}
      onQuit={onBack}
    />
  )
}
