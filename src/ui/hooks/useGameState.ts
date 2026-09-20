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
  /** % of run ticks with reputation >= 70. null before run starts. */
  slaPercent: number | null
}

export function useGameState(scenarioId: string): UseGameStateReturn {
  const [state, setState] = useState<GameState>(() =>
    loadScenario(scenarioId, engineCatalog),
  )
  const [speed, setSpeed] = useState<Speed>(1)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const repZeroTicksRef = useRef(0)

  // SLA score: % of run ticks where reputation >= 70 (the 'good' threshold)
  // Tracked as [ticksAboveThreshold, totalRunTicks]
  const [slaScore, setSlaScore] = useState<[number, number]>([0, 0])

  // Derived views - recomputed when state changes
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
    setSlaScore([0, 0])
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
        const next = advance(s, 1, engineCatalog)
        // Check for sustained reputation failure (10 ticks at 0)
        if (next.carried.reputation <= 0) {
          repZeroTicksRef.current = (repZeroTicksRef.current ?? 0) + 1
          if (repZeroTicksRef.current >= 10) {
            repZeroTicksRef.current = 0
            return endSession(next)
          }
        } else {
          repZeroTicksRef.current = 0
        }
        // Track SLA score: count ticks above 70 rep vs total ticks
        setSlaScore(([above, total]) => [
          above + (next.carried.reputation >= 70 ? 1 : 0),
          total + 1,
        ])
        return next
      })
    }, ms)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.phase, speed])

  // SLA pct: what % of ticks had rep >= 70. null before run starts.
  const slaPercent = slaScore[1] > 0
    ? Math.round((slaScore[0] / slaScore[1]) * 100)
    : null

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
    slaPercent,
  }
}
