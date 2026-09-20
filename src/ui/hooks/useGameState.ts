import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { GameState } from '@engine/types'
import { loadScenario } from '@engine/scenario'
import { canStartRun, startRun, isSessionOver, endSession } from '@engine/session'
import { advance } from '@engine/tick'
import { boardOf, metricsOf } from '@engine/view'
import { engineCatalog } from '../data/catalog'
import type { EngineCatalog } from '@engine/catalogFrom'
import { adaptBoard, adaptMetrics } from '../adapt'
import type { BoardNode, MetricReading } from '../types'
import type { Speed } from '../components/molecules'

/** Real-time ms per tick at each speed setting. 0 = paused. */
const MS_PER_SPEED: Record<Speed, number> = {
  0: 0,      // paused
  1: 1000,   // 1 tick/sec
  2: 500,    // 2 ticks/sec
  3: 250,    // 4 ticks/sec
}

export interface UseGameStateReturn {
  state: GameState
  board: BoardNode[]
  metrics: MetricReading[]
  speed: Speed
  setSpeed: (speed: Speed) => void
  startGame: () => void
  endGame: () => void
  reset: () => void
  phase: GameState['phase']
  tick: number
  catalog: EngineCatalog
  /** Escape hatch for applying outcomes and other engine transforms directly. */
  setState: React.Dispatch<React.SetStateAction<GameState>>
}

export function useGameState(scenarioId: string): UseGameStateReturn {
  const [state, setState] = useState<GameState>(() =>
    loadScenario(scenarioId, engineCatalog),
  )
  const [speed, setSpeed] = useState<Speed>(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Derived views — recomputed when state changes
  const boardViews = boardOf(state, engineCatalog)
  const metricViews = metricsOf(state, engineCatalog)

  const board = adaptBoard(boardViews, state)
  const metrics = adaptMetrics(metricViews)

  const startGame = useCallback(() => {
    setState((s) => {
      if (s.phase !== 'design') return s  // idempotent
      const check = canStartRun(s, engineCatalog)
      if (!check.ok) return s
      return startRun(s, engineCatalog)
    })
  }, [])

  const endGame = useCallback(() => {
    setState((s) => {
      if (s.phase !== 'run') return s
      return endSession(s)
    })
  }, [])

  const reset = useCallback(() => {
    setState(loadScenario(scenarioId, engineCatalog))
    setSpeed(1)
  }, [scenarioId])

  // Clock: runs only in 'run' phase and when speed > 0
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (state.phase !== 'run' || speed === 0) return

    const ms = MS_PER_SPEED[speed]
    intervalRef.current = setInterval(() => {
      setState((s) => {
        if (s.phase !== 'run') return s
        if (isSessionOver(s, engineCatalog)) return endSession(s)
        return advance(s, 1, engineCatalog)
      })
    }, ms)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.phase, speed])

  return {
    state,
    board,
    metrics,
    speed,
    setSpeed,
    startGame,
    endGame,
    setState,
    reset,
    phase: state.phase,
    tick: state.tick,
    catalog: engineCatalog,
  }
}
