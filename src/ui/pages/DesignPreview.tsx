import { useState } from 'react'
import type { DepthMode } from '../types'
import { BoardCanvas, CatalogDrawer, DesignPhasePanel, MetricsHeader } from '../components/organisms'
import { DesignLayout } from '../components/templates'
import type { Speed } from '../components/molecules'
import {
  economy, index, layers, offPathLayers, requestPathLayers,
} from '../data/catalog'
import {
  allNodeDefs, placedCounts, sampleBoard, sampleDesignSummary, sampleMetrics, sampleTick,
} from '../fixtures/sampleRun'

export interface DesignPreviewProps {
  depthMode: DepthMode
  onDepthChange: (mode: DepthMode) => void
}

/**
 * The untimed design phase.
 *
 * Note the right-hand panel reports one unsatisfied port: the fixture board has a
 * worker_pool with nothing wired into its `queue` port, whose `min` is 1. That is
 * a real board error the design phase is supposed to catch before the run starts,
 * and it is why the commit button is disabled here.
 */
export function DesignPreview({ depthMode, onDepthChange }: DesignPreviewProps) {
  const [speed, setSpeed] = useState<Speed>(0)

  return (
    <DesignLayout
      header={
        <MetricsHeader
          readings={sampleMetrics}
          tick={sampleTick}
          tickSeconds={economy.tick_seconds}
          speed={speed}
          onSpeedChange={setSpeed}
          budget={sampleDesignSummary.budget}
          startingBudget={economy.starting_budget}
          depthMode={depthMode}
          onDepthChange={onDepthChange}
        />
      }
      catalog={
        <CatalogDrawer
          nodes={allNodeDefs}
          layers={layers}
          tagById={index.tagById}
          placedCounts={placedCounts}
          budget={sampleDesignSummary.budget}
          onAdd={() => {}}
        />
      }
      board={
        <BoardCanvas
          nodes={sampleBoard}
          requestPathLayers={requestPathLayers}
          offPathLayers={offPathLayers}
          saturationKnee={economy.saturation_knee}
        />
      }
      summary={
        <DesignPhasePanel
          summary={sampleDesignSummary}
          blockedReason={
            sampleDesignSummary.unsatisfiedPorts.length > 0
              ? 'A required port is unwired. The board will not start.'
              : undefined
          }
          onCommit={() => {}}
        />
      }
    />
  )
}
