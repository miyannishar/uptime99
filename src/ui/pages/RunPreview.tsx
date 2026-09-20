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
import { sfx } from '../hooks/useAudio'

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
  showTutorial?: boolean
  /** Called when the tutorial finishes - switch to free play */
  onTutorialComplete?: () => void
}

export function RunPreview({ depthMode, onDepthChange, game, onQuit, showTutorial, onTutorialComplete }: RunPreviewProps) {
  const { state, board, metrics, tick, speed, setSpeed, endGame } = game

  // Pending actions: correctly solved, waiting for time_cost_s ticks to elapse
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  // Use a ref to access current setState - avoids stale closure in the tick effect
  const gameRef = useRef(game)
  gameRef.current = game

  // startGame is called by GameApp in App.tsx before RunPreview mounts.
  // No need to call it again here - the phase is already 'run' when we render.

  // Resolve pending actions when their tick arrives - batched into one setState
  useEffect(() => {
    const ready = pendingActions.filter(p => tick >= p.resolvesAtTick)
    if (ready.length === 0) return
    // Play resolution sound before applying (so it fires once, not in the updater)
    sfx.resolved()
    // Fix D: show toast if any resolved action had an incidentKey (i.e. resolved an incident)
    const resolvedIncident = ready.some(p => p.incidentKey !== null)
    if (resolvedIncident) {
      setToastMessage('✓ Incident cleared — reputation recovering')
      setTimeout(() => setToastMessage(null), 3000)
    }
    // Guided: first action resolved → show the "level starts now" step
    if (tutorialStep === 14) setTutorialStep(15)
    // Apply all ready outcomes in one setState to avoid re-render races
    gameRef.current.setState((s) => {
      let next = s
      for (const p of ready) {
        next = applyOutcome(next, {
          instanceId: p.instanceId,
          actionId: p.actionId,
          minigameInstanceId: p.minigameInstanceId,
          incidentKey: p.incidentKey,
          correct: true,
        }, engineCatalog)
      }
      return next
    })
    setPendingActions(prev => prev.filter(p => tick < p.resolvesAtTick))
  }, [tick, pendingActions])

  // Audio: play alarm when a new incident arrives
  const prevIncidentCountRef = useRef(0)
  useEffect(() => {
    const cur = state.incidents.length
    if (cur > prevIncidentCountRef.current) sfx.incidentArrived()
    prevIncidentCountRef.current = cur
  }, [state.incidents.length])

  const incidents = useMemo(
    () => adaptIncidents(state.incidents, tick),
    [state.incidents, tick],
  )
  const incidentCountByInstance = useMemo(
    () => incidentCountByInstanceFrom(state.incidents),
    [state.incidents],
  )

  // ---- Tutorial state (Level 1 only) ----------------------------------------
  // Phase A: orientation slides (steps 0-5), shown before the incident fires
  // Phase B: guided incident walkthrough (steps 10-15), triggered when oom_kill arrives
  // -1 = tutorial finished
  const [tutorialStep, setTutorialStep] = useState(showTutorial ? 0 : -1)

  // PAUSE the clock while orientation slides are showing so oom_kill can't fire mid-slide
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showTutorial) setSpeed(0) }, [])

  // When the first incident arrives (clock was unpaused after orientation), enter guided phase B
  const guidedEnteredRef = useRef(false)
  useEffect(() => {
    if (!showTutorial || guidedEnteredRef.current) return
    if (state.incidents.length > 0 && tutorialStep === -1) {
      // orientation is done (step is -1) but first incident just fired → guide it
      guidedEnteredRef.current = true
      setSpeed(0)
      setTutorialStep(10)
    }
  }, [state.incidents.length, showTutorial, tutorialStep, setSpeed])

  const prevTutorialStepRef = useRef(tutorialStep)
  useEffect(() => {
    const prev = prevTutorialStepRef.current
    prevTutorialStepRef.current = tutorialStep

    // Orientation finished (slides 0-5 → dismissed) → unpause so oom_kill can fire
    if (prev >= 0 && prev < 10 && tutorialStep < 0) {
      setSpeed(1)
    }
    // Step 14: action is executing - MUST resume the clock so ticks advance and
    // the pending action actually resolves. Without this the 20s countdown freezes.
    if (tutorialStep === 14) {
      setSpeed(1)
    }
    // Guided incident finished (step 15 → dismissed)
    if (prev === 15 && tutorialStep < 0) {
      setSpeed(1)
    }
  }, [tutorialStep, setSpeed])

  // Fix B: track when reputation first hit 0 for urgency countdown
  const repZeroTickRef = useRef<number | null>(null)
  if (state.carried.reputation <= 0) {
    if (repZeroTickRef.current === null) repZeroTickRef.current = tick
  } else {
    repZeroTickRef.current = null
  }
  const repZeroRemaining = repZeroTickRef.current !== null
    ? Math.max(0, Math.min(10, 10 - (tick - repZeroTickRef.current)))
    : null

  // Fix D: toast notification for incident resolved
  const [toastMessage, setToastMessage] = useState<string | null>(null)

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

  // In-progress actions - pending resolutions shown as provisioning entries
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
    if (!minigame || !format || pool.length === 0) return
    // Pick from the pool using the current tick + action id as a seed so
    // replaying the same action gives a different puzzle each time.
    const pickSeed = tick * 31 + actionId.split('').reduce((h, c) => h * 17 + c.charCodeAt(0), 0)
    const instance = pool[Math.abs(pickSeed) % pool.length]

    sfx.open()
    // Guided step: minigame is now open - step transitions to 12 via the
    // onPlayAction wrapper in the feed; nothing to do here.
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

  // Capture the last submit result in a ref so useEffect can act on it once
  const submitResultRef = useRef<{
    correct: boolean
    outcome?: any
    session: MinigameSession
  } | null>(null)

  const onSubmit = useCallback(() => {
    // All computation outside the state updater - updaters must be pure
    // (React StrictMode double-invokes them; side effects inside would fire twice)
    const cur = session
    if (!cur) return

    // When the answer has been revealed (3+ failures), treat next submit as correct
    // so the player can move forward regardless - the lesson was already shown.
    const result = cur.revealed
      ? { correct: true as const, when: undefined }
      : gradeAnswer(cur.instance, cur.answer)

    if (result.correct) {
      sfx.correct()
      submitResultRef.current = { correct: true, session: cur }
      // Guided: player solved the minigame → advance to "action is executing" step
      // advance from either "minigame open" step (12) or "hint" step (13) → "executing" (14)
      if (tutorialStep === 12 || tutorialStep === 13) setTutorialStep(14)
      setSession(null)
      return
    }

    // Wrong answer
    sfx.wrong()
    const outcome = cur.instance.wrong_outcomes.find(
      (o: any) => o.when === 'any' || o.when === result.when,
    )
    submitResultRef.current = { correct: false, outcome, session: cur }
    const attempt = cur.attempt + 1
    setHistory((h) => (outcome ? [...h, outcome] : h))
    setSession({ ...cur, attempt, revealed: attempt > 3 })
  }, [session])

  // Schedule pending actions when session closes after a correct answer
  const prevSessionRef = useRef<MinigameSession | null>(null)
  useEffect(() => {
    const prev = prevSessionRef.current
    prevSessionRef.current = session
    // session just became null and the last result was correct
    if (prev !== null && session === null && submitResultRef.current?.correct) {
      const captured = submitResultRef.current.session
      submitResultRef.current = null
      const instanceId = selectedId
      if (!instanceId) return
      const curState = gameRef.current.state
      const curTick = gameRef.current.tick
      const actionDef = engineCatalog.actionById.get(captured.action.id) as any
      const timeCostTicks = Math.max(1, Math.ceil((actionDef?.time_cost_s ?? 5) / economy.tick_seconds))
      const incidentRecord = curState.incidents.find(r =>
        r.instance_id === instanceId &&
        (engineCatalog.incidentById.get(r.incident_id) as any)?.resolved_by?.includes(captured.action.id)
      ) ?? null
      const node = board.find(n => n.inst.instance_id === instanceId)
      setPendingActions(existing => [
        ...existing,
        {
          instanceId,
          actionId: captured.action.id,
          minigameInstanceId: captured.instance.id,
          incidentKey: incidentRecord?.key ?? null,
          resolvesAtTick: curTick + timeCostTicks,
          actionName: actionDef?.name ?? captured.action.id,
          nodeName: node?.def.name ?? instanceId,
        },
      ])
    }
  }, [session, selectedId, board])

  // TaskDock cooldowns merged with executing actions
  const allCooldowns = useMemo(() => {
    const executing_as_cooldowns = executing.map(e => ({
      node: e.node,
      action: { name: `⟳ ${e.actionName}`, id: '' } as any,
      remainingS: e.secondsLeft,
    }))
    return [...executing_as_cooldowns, ...cooldowns]
  }, [executing, cooldowns])

  type Region = 'header' | 'left' | 'main' | 'right' | 'dock' | null

  // Phase A: orientation (steps 0–5), shown before the incident fires
  const ORIENTATION_STEPS: { title: string; body: string; spotlight: Region }[] = [
    { title: 'Welcome to uptime99', spotlight: null,
      body: 'You\'re the on-call engineer. Incidents will hit your infrastructure. You need to respond before reputation bottoms out. This walkthrough shows you each part of the interface.' },
    { title: 'The board', spotlight: 'main',
      body: 'Your four nodes are arranged left to right: CDN → Load Balancer → App Cluster → PostgreSQL. When an incident hits a node, a red badge appears on it. Click any node to inspect it.' },
    { title: 'Metrics header', spotlight: 'header',
      body: 'The top bar shows live metrics. Watch Reputation - it falls while an incident is active and recovers after. Budget is what you have to spend. Everything else flows from node health.' },
    { title: 'Incident feed', spotlight: 'left',
      body: 'Incidents appear here when they fire. Expand one to see its severity, which nodes it hit, and the actions that can resolve it. The actions are clickable buttons.' },
    { title: 'Node inspector', spotlight: 'right',
      body: 'Click any board node to open the inspector here. It shows health, available actions, and the tier upgrade path. Actions open a task - solve it to apply the fix.' },
    { title: 'Task dock', spotlight: 'dock',
      body: 'After completing a task, the action takes time to execute. This dock shows countdowns, cooldowns, and recent charges. Nothing is instant - watch this strip during an incident.' },
  ]

  // Phase B: guided incident (steps 10–15), triggered when first incident arrives
  const GUIDED_STEPS: Record<number, { title: string; body: string; cta?: string }> = {
    10: { title: '🚨 Incident detected - paused', body: 'An OOM kill just hit your Application Cluster. The clock is paused. Look at the incident feed on the right - it\'s highlighted in red.', cta: 'Click the incident to expand it →' },
    11: { title: 'Good - now act on it', body: 'You can see the incident details. It shows "resolved by: restart, vertical scale". These are clickable buttons - click restart to respond.', cta: 'Click the restart button in the incident feed →' },
    12: { title: 'Task opened', body: 'Read the log output. Identify the root cause - choose the answer that matches what the logs actually show, not the last line.', cta: 'Answer the question and click Submit →' },
    13: { title: 'Solving…', body: 'Think through the log. The OOM killer line is the key - the process was killed because it hit the memory limit, not because of what came after it.', cta: 'Submit your answer →' },
    14: { title: '✓ Correct - action executing', body: 'Restart takes 20 seconds (4 ticks). Watch the task dock at the bottom - it shows the countdown. The incident will clear when the action completes.', cta: 'Waiting for action to resolve…' },
    15: { title: '✅ Incident resolved - Level 1 begins', body: 'The app cluster is recovering. Reputation will climb back. You have 28 ticks left in this scenario. Weighted incidents can arrive now - stay alert. Clock resuming.', cta: 'Start Level 1 →' },
  }

  // Determine which panel to show
  const orientStep = tutorialStep >= 0 && tutorialStep < 10 ? ORIENTATION_STEPS[tutorialStep] : null
  const guidedStepData = tutorialStep >= 10 ? GUIDED_STEPS[tutorialStep] : null
  // const tutStep = orientStep for the orientation panel

  const PANEL_STYLE: React.CSSProperties = {
    background: 'var(--bg-1)', border: '1px solid var(--line-strong)',
    borderRadius: 8, padding: '24px 28px', maxWidth: 460, width: '90%',
    display: 'flex', flexDirection: 'column', gap: 14,
  }
  const BTN_STYLE: React.CSSProperties = {
    padding: '7px 20px', fontSize: 13, fontWeight: 600,
    color: '#fff', background: 'var(--acc)', border: 'none',
    borderRadius: 6, cursor: 'pointer',
  }

  return (
    <>
    {/* ---- Phase A: orientation slides ---- */}
    {/* No full-screen overlay - spotlight CSS dims the other panels.
        The card is positioned next to the highlighted region so the player looks
        at what's being described while reading about it. */}
    {orientStep && (() => {
      // Position the card adjacent to the spotlit panel
      const pos: React.CSSProperties = (() => {
        switch (orientStep.spotlight) {
          case 'header': return { top: 70, left: '50%', transform: 'translateX(-50%)' }
          case 'main':   return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
          case 'left':   return { top: '50%', left: 340, transform: 'translateY(-50%)' }
          case 'right':  return { top: '50%', right: 400, transform: 'translateY(-50%)' }
          case 'dock':   return { bottom: 120, left: '50%', transform: 'translateX(-50%)' }
          default:       return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        }
      })()

      return (
        <div style={{ position: 'fixed', zIndex: 1100, width: 360, maxWidth: '90vw', ...pos }}>
          <div style={{
            ...PANEL_STYLE,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px var(--acc)',
            background: 'color-mix(in srgb, var(--bg-0) 98%, transparent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--acc)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {tutorialStep + 1} / {ORIENTATION_STEPS.length}
              </span>
              <div style={{ flex: 1, height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${((tutorialStep + 1) / ORIENTATION_STEPS.length) * 100}%`, height: '100%', background: 'var(--acc)', transition: 'width 0.3s' }} />
              </div>
            </div>
            <h2 style={{ fontSize: 15, color: 'var(--txt-strong)', margin: 0 }}>{orientStep.title}</h2>
            <p style={{ fontSize: 13, color: 'var(--txt)', lineHeight: 1.65, margin: 0 }}>{orientStep.body}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <button type="button" onClick={() => { setTutorialStep(-1); onTutorialComplete?.() }}
                style={{ fontSize: 12, color: 'var(--txt-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>
                skip tutorial
              </button>
              <button type="button" style={BTN_STYLE}
                onClick={() => setTutorialStep(s => s + 1 < ORIENTATION_STEPS.length ? s + 1 : -1)}>
                {tutorialStep >= ORIENTATION_STEPS.length - 1 ? 'Watch the board →' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      )
    })()}

    {/* ---- Phase B: guided incident walkthrough ---- */}
    {/* Positioned next to the panel the player needs to interact with */}
    {guidedStepData && (
      <div style={{
        position: 'fixed', zIndex: 1100,
        // Steps 10-11: next to the incident feed (left panel)
        ...(tutorialStep <= 11
          ? { top: '50%', left: 340, transform: 'translateY(-50%)', maxWidth: 340 }
          // Steps 12-13: below the board (minigame is modal but hint is visible)
          : tutorialStep <= 13
          ? { bottom: 120, left: '50%', transform: 'translateX(-50%)', maxWidth: 380 }
          // Step 14: above the dock
          : tutorialStep === 14
          ? { bottom: 120, left: '50%', transform: 'translateX(-50%)', maxWidth: 380 }
          // Step 15: centre
          : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: 400 }),
        pointerEvents: 'none',
      }}>
        <div style={{
          ...PANEL_STYLE,
          borderColor: tutorialStep === 10 ? 'var(--bad)' : tutorialStep === 15 ? '#22c55e' : 'var(--acc)',
          boxShadow: tutorialStep === 10
            ? '0 8px 32px rgba(0,0,0,0.7), 0 0 0 2px color-mix(in srgb, var(--bad) 50%, transparent)'
            : '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px var(--acc)',
          background: 'color-mix(in srgb, var(--bg-0) 98%, transparent)',
          pointerEvents: 'auto',
        }}>
          <h3 style={{ fontSize: 15, color: 'var(--txt-strong)', margin: 0 }}>{guidedStepData.title}</h3>
          <p style={{ fontSize: 13, color: 'var(--txt)', lineHeight: 1.6, margin: 0 }}>{guidedStepData.body}</p>
          {guidedStepData.cta && (
            <p style={{ fontSize: 12, color: 'var(--acc)', margin: 0, fontWeight: 600 }}>{guidedStepData.cta}</p>
          )}
          {/* On final step, show a dismiss button; otherwise player action advances it */}
          {(tutorialStep === 15 || tutorialStep === 10) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" style={{ ...BTN_STYLE, background: tutorialStep === 15 ? 'var(--ok, #22c55e)' : 'var(--acc)' }}
                onClick={() => {
                  if (tutorialStep === 10) setTutorialStep(10) // wait for player to click
                  if (tutorialStep === 15) {
                    setTutorialStep(-1)
                    onTutorialComplete?.()  // switch to free play
                  }
                }}>
                {tutorialStep === 15 ? 'Start Free Play →' : 'Got it - I\'ll click it'}
              </button>
            </div>
          )}
        </div>
      </div>
    )}

    <RunLayout
      spotlightRegion={
        orientStep?.spotlight ??
        (tutorialStep === 10 || tutorialStep === 11 ? 'left' :   // incident feed
         tutorialStep === 12 || tutorialStep === 13 ? null :      // minigame is modal, no spotlight
         tutorialStep === 14 ? 'dock' :                           // task dock countdown
         tutorialStep === 15 ? 'main' :                           // board (node healed)
         null)
      }
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
          {/* Fix B: urgency countdown when reputation is 0 */}
          {repZeroRemaining !== null && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 800,
              background: 'rgba(220,38,38,0.92)', color: '#fff',
              fontWeight: 700, fontSize: 13, textAlign: 'center',
              padding: '5px 0',
              animation: 'pulse 1s ease-in-out infinite',
            }}>
              REPUTATION AT ZERO — {repZeroRemaining} ticks until failure
            </div>
          )}
          {/* Fix E: budget critical warning */}
          {state.budget < 200 && state.budget > 0 && (
            <div style={{
              position: 'absolute', bottom: -22, left: '50%', transform: 'translateX(-50%)',
              fontSize: 11, color: '#f59e0b', fontWeight: 600, pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
              ⚠ Budget critical: {state.budget} left
            </div>
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
            onUpgradeTier={() => openMinigame(selected.inst.instance_id, 'upgrade_tier')}
            conditionNote={
              selected.inst.down ? 'host fault · node unreachable' :
              selected.inst.health < 60 ? `health degraded · ${selected.inst.health}%` :
              undefined
            }
            sleds={(() => {
              // Map node health to sled states (decorative representation of rack health)
              const h = selected.inst.health
              if (selected.inst.down) return ['ok', 'bad', 'off', 'off', 'ok'] as any
              if (h < 30) return ['bad', 'bad', 'off', 'off', 'ok'] as any
              if (h < 60) return ['ok', 'warn', 'off', 'off', 'ok'] as any
              return ['ok', 'ok', 'off', 'off', 'ok'] as any
            })()}
            saturationKnee={economy.saturation_knee}
          />
        )
      }
      feed={
        <IncidentFeed
          incidents={incidents}
          selectedKey={selectedIncident}
          onSelect={(key) => {
            setSelectedIncident(key === selectedIncident ? null : key)
            // Guided: player clicked the incident → advance to "click restart" step
            if (tutorialStep === 10 && key !== selectedIncident) setTutorialStep(11)
          }}
          tickSeconds={economy.tick_seconds}
          onPlayAction={(instanceId, actionId) => {
            // Guided: player clicked a resolve action from the feed → advance
            if (tutorialStep === 11) setTutorialStep(12)  // minigame is now open
            openMinigame(instanceId, actionId)
          }}
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
          {/* Fix D: incident cleared toast */}
          {toastMessage && (
            <div style={{
              position: 'fixed', bottom: 80, right: 20, zIndex: 900,
              background: 'rgba(22, 163, 74, 0.95)', color: '#fff',
              fontWeight: 600, fontSize: 13, borderRadius: 8,
              padding: '10px 16px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              animation: 'slideInRight 0.25s ease-out',
            }}>
              {toastMessage}
            </div>
          )}
        </>
      }
    />
    </>
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
