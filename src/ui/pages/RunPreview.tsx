import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DepthMode, MinigameAnswer, MinigameSession, WrongOutcome } from '../types'
import {
  BoardCanvas, CommandPalette, IncidentFeed, MetricsHeader, MinigameShell, NodeInspector,
} from '../components/organisms'
import { MinigameOverlay, RunLayout } from '../components/templates'
import type { Speed } from '../components/molecules'
import { economy, index, instancesForSlot, offPathLayers, requestPathLayers } from '../data/catalog'
import {
  incidentCountByInstance, ladderFor, portsFor, resolvedActionsFor, sampleBoard,
  sampleIncidents, sampleMetrics, samplePaletteEntries, sampleTick,
} from '../fixtures/sampleRun'

export interface RunPreviewProps {
  depthMode: DepthMode
  onDepthChange: (mode: DepthMode) => void
}

/**
 * The run phase, wired end to end against fixture state.
 *
 * This is a presentation harness, not the game: there is no tick loop and no
 * engine, so the "failure" on each minigame attempt is simulated in order to
 * exercise the teaching loop (wrong outcome → wrong outcome → reveal). Every
 * component below receives exactly the props the engine will supply later.
 */
export function RunPreview({ depthMode, onDepthChange }: RunPreviewProps) {
  const [selectedId, setSelectedId] = useState<string | null>('pg-primary')
  const [selectedIncident, setSelectedIncident] = useState<string | null>(
    sampleIncidents[0]?.key ?? null,
  )
  const [speed, setSpeed] = useState<Speed>(1)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [session, setSession] = useState<MinigameSession | null>(null)
  const [history, setHistory] = useState<WrongOutcome[]>([])

  const selected = useMemo(
    () => sampleBoard.find((n) => n.inst.instance_id === selectedId) ?? null,
    [selectedId],
  )

  const actions = useMemo(() => (selected ? resolvedActionsFor(selected) : []), [selected])

  /* ⌘K / Ctrl+K */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Build a session from the action's own minigame + difficulty slot. */
  const openMinigame = useCallback((instanceId: string, actionId: string) => {
    const node = sampleBoard.find((n) => n.inst.instance_id === instanceId)
    const action = index.actionById.get(actionId)
    if (!node || !action) return
    const minigame = index.minigameById.get(action.minigame)
    const format = minigame ? index.formatById.get(minigame.format) : undefined
    const pool = instancesForSlot(action.minigame, action.difficulty)
    const instance = pool[0]
    if (!minigame || !format || !instance) return

    setSelectedId(instanceId)
    setHistory([])
    setSession({
      instance,
      minigame,
      format,
      action,
      attempt: 1,
      revealed: false,
      answer: blankAnswer(format.id, instance),
    })
  }, [])

  const onAnswerChange = useCallback((answer: MinigameAnswer) => {
    setSession((prev) => (prev ? { ...prev, answer } : prev))
  }, [])

  /**
   * Simulated submit: fail the first three attempts so the wrong-outcome history
   * and the reveal are both reachable from the UI. The engine will judge for real.
   */
  const onSubmit = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev
      if (prev.attempt > 3) return null
      const outcome =
        prev.instance.wrong_outcomes[
          Math.min(prev.attempt - 1, prev.instance.wrong_outcomes.length - 1)
        ]
      if (outcome) setHistory((h) => [...h, outcome])
      const attempt = prev.attempt + 1
      return { ...prev, attempt, revealed: attempt > 3 }
    })
  }, [])

  return (
    <RunLayout
      header={
        <MetricsHeader
          readings={sampleMetrics}
          tick={sampleTick}
          tickSeconds={economy.tick_seconds}
          speed={speed}
          onSpeedChange={setSpeed}
          budget={1_240}
          startingBudget={economy.starting_budget}
          depthMode={depthMode}
          onDepthChange={onDepthChange}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      }
      board={
        <BoardCanvas
          nodes={sampleBoard}
          requestPathLayers={requestPathLayers}
          offPathLayers={offPathLayers}
          selectedInstanceId={selectedId}
          onSelect={setSelectedId}
          incidentCountByInstance={incidentCountByInstance}
          saturationKnee={economy.saturation_knee}
        />
      }
      inspector={
        selected && (
          <NodeInspector
            node={selected}
            actions={actions}
            ladder={ladderFor(selected)}
            ports={portsFor(selected)}
            incidents={sampleIncidents.filter((i) =>
              i.affectedInstanceIds.includes(selected.inst.instance_id),
            )}
            nameOf={(id) =>
              sampleBoard.find((n) => n.inst.instance_id === id)?.def.name ?? id
            }
            onPlayAction={(actionId) => openMinigame(selected.inst.instance_id, actionId)}
            conditionNote={
              selected.inst.down ? 'host fault · sled 2 failed · no replica' : undefined
            }
            sleds={selected.inst.down ? ['ok', 'bad', 'off', 'off', 'ok'] : ['ok', 'ok', 'off', 'off', 'ok']}
            saturationKnee={economy.saturation_knee}
          />
        )
      }
      feed={
        <IncidentFeed
          incidents={sampleIncidents}
          selectedKey={selectedIncident}
          onSelect={(key) => setSelectedIncident(key === selectedIncident ? null : key)}
          tickSeconds={economy.tick_seconds}
        />
      }
      overlay={
        <>
          <MinigameOverlay open={Boolean(session)} onDismiss={() => setSession(null)}>
            {session && (
              <MinigameShell
                session={session}
                history={history}
                onAnswerChange={onAnswerChange}
                onSubmit={onSubmit}
                onCancel={() => setSession(null)}
              />
            )}
          </MinigameOverlay>

          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            entries={samplePaletteEntries}
            onRun={openMinigame}
          />
        </>
      }
    />
  )
}

function blankAnswer(formatId: string, instance: MinigameSession['instance']): MinigameAnswer {
  switch (formatId) {
    case 'ordered_sequence': {
      const given = instance.given as { steps: string[] }
      return { kind: 'ordered_sequence', order: given.steps.map((_, i) => i) }
    }
    case 'fill_blank':
      return { kind: 'fill_blank', blanks: {} }
    case 'dial': {
      const given = instance.given as { range: { min: number; max: number } }
      return { kind: 'dial', value: given.range.min }
    }
    case 'wiring':
      return { kind: 'wiring', zone: null, connectTo: [] }
    default:
      return { kind: 'evidence', choice: null }
  }
}
