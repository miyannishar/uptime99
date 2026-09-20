import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepthMode, MinigameAnswer, MinigameSession, WrongOutcome } from '../types'
import {
  BoardCanvas, CommandPalette, IncidentFeed, MetricsHeader, MinigameShell, NodeInspector,
  TaskDock,
} from '../components/organisms'
import { MinigameOverlay, RunLayout } from '../components/templates'
import { economy, engineCatalog, index, instancesForSlot, offPathLayers, requestPathLayers } from '../data/catalog'
import { samplePaletteEntries } from '../fixtures/sampleRun'
import { adaptActions, adaptIncidents, adaptLedger, adaptTierLadder, incidentCountByInstanceFrom } from '../adapt'
import { actionsFor, tierLadder } from '@engine/actions'
import { applyOutcome, gradeAnswer } from '@engine/grading'
import type { UseGameStateReturn } from '../hooks/useGameState'

/** An action that was correctly solved and is now executing (delayed resolve). */
interface PendingAction {
  instanceId: string
  actionId: string
  minigameInstanceId: string
  incidentKey: string | null
  resolvesAtTick: number
  actionName: string
  nodeName: string
}

export interface RunPreviewProps {
  depthMode: DepthMode
  onDepthChange: (mode: DepthMode) => void
  game: UseGameStateReturn
  onQuit?: () => void
}

export function RunPreview({ depthMode, onDepthChange, game, onQuit }: RunPreviewProps) {
  const { state, board, metrics, tick, speed, setSpeed, startGame, endGame } = game

  // Pending actions: correctly solved, waiting for time_cost_s ticks to elapse
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  // Use a ref to access current setState — avoids stale closure in the tick effect
  const gameRef = useRef(game)
  gameRef.current = game

  // Auto-start once on mount — idempotent if already running
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { startGame() }, [])

  // Resolve pending actions when their tick arrives
  useEffect(() => {
    const ready = pendingActions.filter(p => tick >= p.resolvesAtTick)
    if (ready.length === 0) return
    for (const p of ready) {
      gameRef.current.setState((s) =>
        applyOutcome(s, {
          instanceId: p.instanceId,
          actionId: p.actionId,
          minigameInstanceId: p.minigameInstanceId,
          incidentKey: p.incidentKey,
          correct: true,
        }, engineCatalog)
      )
    }
    setPendingActions(prev => prev.filter(p => tick < p.resolvesAtTick))
  }, [tick, pendingActions])

  const incidents = useMemo(
    () => adaptIncidents(state.incidents, tick),
    [state.incidents, tick],
  )
  const incidentCountByInstance = useMemo(
    () => incidentCountByInstanceFrom(state.incidents),
    [state.incidents],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<string | null>(
    incidents[0]?.key ?? null,
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [session, setSession] = useState<MinigameSession | null>(null)
  const [history, setHistory] = useState<WrongOutcome[]>([])

  const selected = useMemo(
    () => board.find((n) => n.inst.instance_id === selectedId) ?? null,
    [selectedId, board],
  )

  const actions = useMemo(() => {
    if (!selected) return []
    return adaptActions(actionsFor(state, selected.inst.instance_id, engineCatalog))
  }, [state, selected])

  const ladder = useMemo(() => {
    if (!selected) return []
    return adaptTierLadder(
      tierLadder(state, selected.inst.instance_id, engineCatalog),
      selected.def.id,
    )
  }, [state, selected])

  const ports = useMemo(() => {
    if (!selected) return []
    return selected.def.requires.map((port: any) => {
      const filled = selected.inst.edges_out.filter((targetId: string) => {
        const target = board.find(n => n.inst.instance_id === targetId)
        return target ? target.def.provides.some((cap: string) => port.accepts.includes(cap)) : false
      })
      return { port, filled, satisfied: filled.length >= port.min && filled.length <= port.max }
    })
  }, [selected, board])

  const provisioning = useMemo(
    () => board
      .filter((n) => (n.provisioningTicksLeft ?? 0) > 0)
      .map((node) => ({ node, ticksLeft: node.provisioningTicksLeft ?? 0 })),
    [board],
  )

  // Cooldowns from engine + in-progress pending actions (shown as their own section)
  const cooldowns = useMemo(
    () => board.flatMap((node) =>
      actionsFor(state, node.inst.instance_id, engineCatalog)
        .filter((a) => a.availability === 'cooldown')
        .map((a) => {
          const def = engineCatalog.actionById.get(a.action_id)
          if (!def) return null
          return { node, action: def, remainingS: a.cooldownRemainingS }
        })
        .filter(Boolean) as any[]),
    [state, board],
  )

  // In-progress actions — pending resolutions shown as provisioning entries
  const executing = useMemo(
    () => pendingActions.map(p => {
      const node = board.find(n => n.inst.instance_id === p.instanceId)
      if (!node) return null
      const ticksLeft = Math.max(0, p.resolvesAtTick - tick)
      const secondsLeft = ticksLeft * economy.tick_seconds
      return { node, ticksLeft, secondsLeft, actionName: p.actionName }
    }).filter(Boolean) as { node: typeof board[0]; ticksLeft: number; secondsLeft: number; actionName: string }[],
    [pendingActions, board, tick],
  )

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

  const openMinigame = useCallback((instanceId: string, actionId: string) => {
    const node = board.find((n) => n.inst.instance_id === instanceId)
    const action = index.actionById.get(actionId)
    if (!node || !action) return
    const minigame = index.minigameById.get((action as any).minigame)
    const format = minigame ? index.formatById.get(minigame.format) : undefined
    const pool = instancesForSlot((action as any).minigame, (action as any).difficulty)
    const instance = pool[0]
    if (!minigame || !format || !instance) return

    setSelectedId(instanceId)
    setHistory([])
    setSession({
      instance, minigame, format, action,
      attempt: 1, revealed: false,
      answer: blankAnswer(format.id, instance),
    })
  }, [board])

  const onAnswerChange = useCallback((answer: MinigameAnswer) => {
    setSession((prev) => (prev ? { ...prev, answer } : prev))
  }, [])

  const onSubmit = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev
      const result = gradeAnswer(prev.instance, prev.answer)

      if (result.correct) {
        // selectedId is always set when a session is open (openMinigame sets it)
        const instanceId = selectedId
        const curState = gameRef.current.state
        const curTick = gameRef.current.tick
        const actionDef = engineCatalog.actionById.get(prev.action.id) as any
        // Convert seconds to ticks (ceil so the resolve always takes at least 1 tick)
        const timeCostTicks = Math.max(1, Math.ceil((actionDef?.time_cost_s ?? 5) / economy.tick_seconds))

        // Find the first active incident on this instance that this action resolves
        const incidentRecord = instanceId
          ? (curState.incidents.find(r =>
              r.instance_id === instanceId &&
              (engineCatalog.incidentById.get(r.incident_id) as any)?.resolved_by?.includes(prev.action.id)
            ) ?? null)
          : null

        const node = board.find(n => n.inst.instance_id === instanceId)

        if (instanceId) {
          setPendingActions(existing => [
            ...existing,
            {
              instanceId,
              actionId: prev.action.id,
              minigameInstanceId: prev.instance.id,
              incidentKey: incidentRecord?.key ?? null,
              resolvesAtTick: curTick + timeCostTicks,
              actionName: actionDef?.name ?? prev.action.id,
              nodeName: node?.def.name ?? instanceId,
            },
          ])
        }
        return null  // close the minigame shell
      }

      // Wrong answer
      const outcome = prev.instance.wrong_outcomes.find(
        (o: any) => o.when === 'any' || o.when === result.when,
      )
      if (outcome) setHistory((h) => [...h, outcome])
      const attempt = prev.attempt + 1
      return { ...prev, attempt, revealed: attempt > 3 }
    })
  }, [selectedId, board])

  // TaskDock cooldowns merged with executing actions
  const allCooldowns = useMemo(() => {
    const executing_as_cooldowns = executing.map(e => ({
      node: e.node,
      action: { name: `⟳ ${e.actionName}`, id: '' } as any,
      remainingS: e.secondsLeft,
    }))
    return [...executing_as_cooldowns, ...cooldowns]
  }, [executing, cooldowns])

  return (
    <RunLayout
      header={
        <>
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
            onOpenPalette={() => setPaletteOpen(true)}
          />
          {onQuit && (
            <button
              type="button"
              onClick={() => { endGame(); onQuit() }}
              style={{ position: 'absolute', top: 8, right: 12, fontSize: '11px', color: 'var(--txt-dim)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
            >
              ✕ quit
            </button>
          )}
        </>
      }
      board={
        <BoardCanvas
          nodes={board}
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
            ladder={ladder}
            ports={ports as any}
            incidents={incidents.filter((i) =>
              i.affectedInstanceIds.includes(selected.inst.instance_id),
            )}
            nameOf={(id) => board.find((n) => n.inst.instance_id === id)?.def.name ?? id}
            onPlayAction={(actionId) => openMinigame(selected.inst.instance_id, actionId)}
            conditionNote={selected.inst.down ? 'host fault · node unreachable' : undefined}
            sleds={selected.inst.down ? ['ok', 'bad', 'off', 'off', 'ok'] : ['ok', 'ok', 'off', 'off', 'ok']}
            saturationKnee={economy.saturation_knee}
          />
        )
      }
      feed={
        <IncidentFeed
          incidents={incidents}
          selectedKey={selectedIncident}
          onSelect={(key) => setSelectedIncident(key === selectedIncident ? null : key)}
          tickSeconds={economy.tick_seconds}
          onPlayAction={openMinigame}
        />
      }
      dock={
        <TaskDock
          provisioning={provisioning}
          cooldowns={allCooldowns}
          ledger={adaptLedger(state.ledger)}
          tickSeconds={economy.tick_seconds}
          onSelectNode={setSelectedId}
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
