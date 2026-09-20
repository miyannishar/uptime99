import { useMemo, useState } from 'react'
import type { DepthMode } from '../types'
import { BoardCanvas, CatalogDrawer, DesignPhasePanel, MetricsHeader } from '../components/organisms'
import { DesignLayout } from '../components/templates'
import type { Speed } from '../components/molecules'
import { economy, engineCatalog, layers, nodes, offPathLayers, requestPathLayers } from '../data/catalog'
import { adaptDesignSummary } from '../adapt'
import { designSummary } from '@engine/summary'
import type { UseGameStateReturn } from '../hooks/useGameState'

export interface DesignPreviewProps {
  depthMode: DepthMode
  onDepthChange: (mode: DepthMode) => void
  game: UseGameStateReturn
}

export function DesignPreview({ depthMode, onDepthChange, game }: DesignPreviewProps) {
  const { state, board, metrics, tick, startGame } = game
  const [speed, setSpeed] = useState<Speed>(0)

  const placedCounts = useMemo(
    () => state.instances.reduce<Record<string, number>>((acc, inst) => {
      acc[inst.def_id] = (acc[inst.def_id] ?? 0) + 1
      return acc
    }, {}),
    [state.instances],
  )

  const engineSummary = useMemo(() => designSummary(state, engineCatalog), [state])
  const summary = useMemo(
    () => adaptDesignSummary(engineSummary, board, metrics),
    [engineSummary, board, metrics],
  )

  return (
    <DesignLayout
      header={
        <MetricsHeader
          readings={metrics}
          tick={tick}
          tickSeconds={economy.tick_seconds}
          speed={speed}
          onSpeedChange={setSpeed}
          budget={state.budget}
          startingBudget={economy.starting_budget}
          depthMode={depthMode}
          onDepthChange={onDepthChange}
        />
      }
      catalog={
        <CatalogDrawer
          nodes={nodes as any}
          layers={layers as any}
          tagById={engineCatalog.tagById as any}
          placedCounts={placedCounts}
          budget={state.budget}
          onAdd={() => {}}
        />
      }
      board={
        <BoardCanvas
          nodes={board}
          requestPathLayers={requestPathLayers}
          offPathLayers={offPathLayers}
          saturationKnee={economy.saturation_knee}
        />
      }
      summary={
        <DesignPhasePanel
          summary={summary}
          blockedReason={
            summary.unsatisfiedPorts.length > 0
              ? 'A required port is unwired. The board will not start.'
              : undefined
          }
          onCommit={startGame}
        />
      }
    />
  )
}
