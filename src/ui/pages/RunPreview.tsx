import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepthMode, MinigameAnswer, MinigameSession, WrongOutcome } from '../types'
import {
  BoardCanvas, CommandPalette, IncidentFeed, MetricsHeader, MinigameShell, NodeInspector,
  TaskDock, TicketFeed, PagerOverlay, StakeholderCard,
} from '../components/organisms'
import type { PagerPage } from '../components/organisms/PagerOverlay'
import { MinigameOverlay, RunLayout } from '../components/templates'
import { economy, engineCatalog, index, instancesForSlot, offPathLayers, requestPathLayers } from '../data/catalog'
import { samplePaletteEntries } from '../fixtures/sampleRun'
import { adaptActions, adaptIncidents, adaptLedger, adaptTierLadder, adaptTickets, incidentCountByInstanceFrom } from '../adapt'
import { actionsFor, tierLadder } from '@engine/actions'
import { applyOutcome, gradeAnswer } from '@engine/grading'
import { buildNodeContext, buildIncidentContext, buildSeedContext, resolveObject } from '@engine/template'
import { eligibleInstances, pickInstance, pickSlot } from '@engine/minigamePick'
import { seedFrom } from '@engine/rng'
import { applyAiPatch } from '@engine/aiMerge'
import { createAiClient } from '../ai/aiClient'
import { applyStakeholderResponse, dueStakeholderMessages, ignoredResponse, type StakeholderDef } from '@engine/stakeholders'
import { actionBlockedReason, resolveHintTarget } from '../hintTarget'
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
  const { state, board, metrics, tick, speed, setSpeed, endGame, slaPercent } = game

  // Pending actions: correctly solved, waiting for time_cost_s ticks to elapse
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  // Use a ref to access current setState - avoids stale closure in the tick effect
  const gameRef = useRef(game)
  gameRef.current = game

  // Speed saved before a minigame opens — restored when the minigame closes
  const preMinigameSpeedRef = useRef<typeof speed>(1)

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

  // Audio + tab switch when a new incident arrives
  const prevIncidentCountRef = useRef(0)
  useEffect(() => {
    const cur = state.incidents.length
    if (cur > prevIncidentCountRef.current) {
      sfx.incidentArrived()
    }
    prevIncidentCountRef.current = cur
  }, [state.incidents.length])

  const incidents = useMemo(
    () => adaptIncidents(state.incidents, tick, state),
    [state.incidents, state, tick],
  )
  const incidentCountByInstance = useMemo(
    () => incidentCountByInstanceFrom(state.incidents),
    [state.incidents],
  )

  // ---- Tutorial state (Level 1 only) ----------------------------------------
  // Orientation slides (steps 0–5), shown before play begins.
  // -1 = tutorial finished or not shown
  const [tutorialStep, setTutorialStep] = useState(showTutorial ? 0 : -1)

  // ---- Pager: full-screen page for SEV4+ arrivals ---------------------------
  // Queue of unacknowledged pages and how each incident's page was handled.
  const [pages, setPages] = useState<PagerPage[]>([])
  const [ackByKey, setAckByKey] = useState<ReadonlyMap<string, number | 'unacked'>>(new Map())
  const pagedKeysRef = useRef(new Set<string>())
  useEffect(() => {
    if (tutorialStep >= 0) return
    const fresh: PagerPage[] = []
    for (const r of state.incidents) {
      if (pagedKeysRef.current.has(r.key)) continue
      pagedKeysRef.current.add(r.key)
      const def = engineCatalog.incidentById.get(r.incident_id) as any
      if (!def || def.severity < 4) continue
      const l0 = (def.signals ?? []).find((sg: any) => sg.level === 0)
      fresh.push({ key: r.key, name: def.name, severity: def.severity, text: l0?.text ?? 'Something is wrong.' })
    }
    if (fresh.length) setPages((q) => [...q, ...fresh])
  }, [state.incidents, tutorialStep])
  const settlePage = (key: string, result: number | 'unacked') => {
    setAckByKey((m) => new Map(m).set(key, result))
    setPages((q) => q.filter((p) => p.key !== key))
  }

  // ---- Stakeholder messages -------------------------------------------------
  // At most one on screen; never during the tutorial, a page, or a minigame.
  const [stakeholderMsg, setStakeholderMsg] = useState<StakeholderDef | null>(null)
  const lastShownRef = useRef<Record<string, number>>({})

  // PAUSE the clock while orientation slides are showing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showTutorial) setSpeed(0) }, [])

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

  // Tab switcher state for the left feed panel
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)

  // Ticket data
  const tickets = useMemo(
    () => adaptTickets(state.active_tickets, engineCatalog, tick, state),
    [state.active_tickets, state, tick],
  )
  const pendingTicketCount = tickets.filter(t => t.status !== 'completed').length

  // Auto-switch to tickets tab when a new ticket activates — but only when no
  // incidents are active so we don't hijack the player mid-response.
  const prevTicketCountRef = useRef(0)
  useEffect(() => {
    // (split-screen layout — both sections always visible, no tab switch needed)
    prevTicketCountRef.current = pendingTicketCount
  }, [pendingTicketCount, incidents.length])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIncident, setSelectedIncident] = useState<string | null>(
    incidents[0]?.key ?? null,
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [session, setSession] = useState<MinigameSession | null>(null)

  useEffect(() => {
    if (tutorialStep >= 0 || stakeholderMsg || session || pages.length > 0 || state.phase !== 'run') return
    const due = dueStakeholderMessages(state, engineCatalog, lastShownRef.current)
    if (due.length === 0) return
    lastShownRef.current = { ...lastShownRef.current, [due[0].id]: state.tick }
    setStakeholderMsg(due[0])
  }, [tick, tutorialStep, stakeholderMsg, session, pages.length])
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

  // One AI client per mounted run: prefetches rewritten puzzle text in the
  // background; openMinigame only ever reads what has already arrived.
  const aiClientRef = useRef<ReturnType<typeof createAiClient> | null>(null)
  if (aiClientRef.current === null) aiClientRef.current = createAiClient()

  /**
   * The puzzle a given action would open on a node for a context key, resolved
   * against live state. Shared by openMinigame and the AI prefetch so both agree
   * on exactly which instance — and cache key — a context produces.
   */
  const chooseInstance = useCallback((curState: typeof state, instanceId: string, actionId: string, contextKey?: string) => {
    const action = index.actionById.get(actionId)
    if (!action || !curState.instances.some((i) => i.instance_id === instanceId)) return null

    // Build context: node state first, then layer in incident context if applicable
    let ctx = buildNodeContext(curState, instanceId, engineCatalog)
    const incidentRecord = curState.incidents.find(r =>
      r.instance_id === instanceId &&
      (engineCatalog.incidentById.get(r.incident_id) as any)?.resolved_by?.includes(actionId)
    )
    if (incidentRecord) {
      ctx = { ...ctx, ...buildIncidentContext(curState, incidentRecord.key, engineCatalog) }
    }

    // Deterministic choice of minigame slot and instance: the same incident or
    // ticket in the same run always opens the same puzzle; different ones vary.
    // rng_seed advances every tick, so it cannot anchor the choice; the scenario
    // id is fixed for the whole run.
    const key = contextKey ?? incidentRecord?.key ?? `${instanceId}:${curState.tick}`
    const seed = seedFrom(curState.scenario_id)
    const slot = pickSlot(action as any, key, seed)
    const minigame = index.minigameById.get(slot.minigame)
    const format = minigame ? index.formatById.get(minigame.format) : undefined
    const rawInstance = pickInstance(eligibleInstances(instancesForSlot(slot.minigame, slot.difficulty), actionId), key, seed)
    if (!minigame || !format || !rawInstance) return null
    // Generated facts (ids, revisions, tenants…) seeded by the same key, so each
    // incident's puzzle has its own details and answer; live state wins on overlap.
    ctx = { ...buildSeedContext(key), ...ctx }
    const instance = resolveObject(rawInstance, ctx)
    return { action, minigame, format, instance, ctx, cacheKey: `${rawInstance.id}|${key}` }
  }, [])

  // Prefetch AI text for what a new incident or ticket would open, so the
  // rewrite is ready by the time the player clicks.
  const prefetchedRef = useRef(new Set<string>())
  useEffect(() => {
    const ai = aiClientRef.current!
    const want = (instanceId: string, actionId: string, contextKey: string) => {
      const tag = `${instanceId}|${actionId}|${contextKey}`
      if (prefetchedRef.current.has(tag)) return
      prefetchedRef.current.add(tag)
      const c = chooseInstance(state, instanceId, actionId, contextKey)
      if (!c) return
      ai.prefetch(c.cacheKey, c.instance, (c.format as any).ai_fields ?? [], c.ctx as any)
    }
    for (const r of state.incidents) {
      if (!r.instance_id) continue
      const def = engineCatalog.incidentById.get(r.incident_id) as any
      const offered = new Set(actionsFor(state, r.instance_id, engineCatalog).map((v) => v.action_id))
      for (const a of def?.resolved_by ?? []) if (offered.has(a)) want(r.instance_id, a, r.key)
    }
    for (const rec of state.active_tickets) {
      if (rec.completed) continue
      const def = engineCatalog.ticketById.get(rec.ticket_id) as any
      const hint = def?.hint_actions?.[0]
      if (!hint) continue
      const t = resolveHintTarget(state, engineCatalog, def, hint)
      if (t.instanceId) want(t.instanceId, hint, `ticket:${rec.ticket_id}`)
    }
  }, [state.incidents, state.active_tickets, chooseInstance])

  const openMinigame = useCallback((instanceId: string, actionId: string, contextKey?: string) => {
    const node = board.find((n) => n.inst.instance_id === instanceId)
    if (!node) return
    const chosen = chooseInstance(gameRef.current.state, instanceId, actionId, contextKey)
    if (!chosen) return
    const { action, minigame, format } = chosen
    const aiFields: readonly string[] = (format as any).ai_fields ?? []
    const patch = aiClientRef.current!.get(chosen.cacheKey)
    const instance = patch ? applyAiPatch(chosen.instance, aiFields, patch) : chosen.instance

    sfx.open()
    // Pause clock while the minigame is open — restore on dismiss or correct submit
    preMinigameSpeedRef.current = gameRef.current.speed
    setSpeed(0)
    setSelectedId(instanceId)
    setHistory([])
    setSession({
      instance, minigame, format, action,
      attempt: 1, revealed: false,
      answer: blankAnswer(format.id, instance),
      aiText: patch !== null,
    })
  }, [board, chooseInstance])

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
      setSession(null)
      setSpeed(preMinigameSpeedRef.current)
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

  // Orientation step definitions (steps 0–5). Each step spotlights the region it
  // describes and parks the card over a region that is dimmed, so it never covers
  // what the player is being shown.
  type Placement = 'center' | 'top-right' | 'top-center' | 'bottom-center'
  const ORIENTATION_STEPS: { title: string; body: string; region: 'header' | 'left' | 'main' | 'right' | 'dock' | null; placement: Placement }[] = [
    { title: 'Welcome to uptime99', region: null, placement: 'center',
      body: 'You\'re the on-call engineer. Incidents will hit your infrastructure and reputation will fall. Respond before it bottoms out. This short tour shows you where everything is.' },
    { title: 'The board', region: 'main', placement: 'bottom-center',
      body: 'Your nodes are arranged left to right along the request path: CDN → Load Balancer → App Cluster → PostgreSQL. When an incident hits a node, a red badge appears on it. Click any node to inspect it.' },
    { title: 'Metrics header', region: 'header', placement: 'top-center',
      body: 'The top bar tracks live metrics. Watch Reputation — it falls while an incident is active and recovers after you fix it. Budget is what you have to spend on actions and upgrades.' },
    { title: 'Incident & ticket feeds', region: 'left', placement: 'top-right',
      body: 'The left panel has two columns. Incidents (left) shows live alerts — expand one to see what nodes are affected and which actions can resolve it. Tickets (right) shows proactive work items with deadlines.' },
    // The inspector panel only renders once a node is selected, so spotlight the
    // board the player clicks rather than an empty region.
    { title: 'Node inspector', region: 'main', placement: 'bottom-center',
      body: 'Click any node on the board to open its inspector on the right. It shows health, available actions, and the tier upgrade path. Click an action to open the task and solve it.' },
    { title: 'Task dock', region: 'dock', placement: 'top-center',
      body: 'After you solve a task, the action takes real time to execute. The dock at the bottom shows countdowns, cooldowns, and recent charges. Nothing is instant — watch this during incidents.' },
  ]

  const PLACEMENT_STYLE: Record<Placement, React.CSSProperties> = {
    'center':     { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    'top-right':  { top: 90, right: 24 },
    'top-center': { top: 140, left: '50%', transform: 'translateX(-50%)' },
    'bottom-center': { bottom: 24, left: '50%', transform: 'translateX(-50%)' },
  }

  // Current orientation slide (null when tutorial is done or not shown)
  const orientStep = tutorialStep >= 0 ? ORIENTATION_STEPS[tutorialStep] ?? null : null

  const PANEL_STYLE: React.CSSProperties = {
    background: 'var(--bg-1)', border: '1px solid var(--line-strong)',
    borderRadius: 10, padding: '28px 32px', width: 480, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
  }
  const BTN_STYLE: React.CSSProperties = {
    padding: '8px 22px', fontSize: 13, fontWeight: 600,
    color: '#fff', background: 'var(--acc)', border: 'none',
    borderRadius: 6, cursor: 'pointer',
  }

  const dismissTutorial = () => {
    setTutorialStep(-1)
    setSpeed(1)
    onTutorialComplete?.()
  }

  return (
    <>
    {stakeholderMsg && (
      <StakeholderCard
        key={stakeholderMsg.id + ':' + (lastShownRef.current[stakeholderMsg.id] ?? 0)}
        message={stakeholderMsg}
        onResolve={(r) => {
          const choice = r ?? ignoredResponse(stakeholderMsg)
          gameRef.current.setState((st) => applyStakeholderResponse(st, choice))
        }}
        onDone={() => setStakeholderMsg(null)}
      />
    )}
    {pages[0] && (
      <PagerOverlay
        page={pages[0]}
        onTone={() => sfx.incidentArrived()}
        onAck={(key, secs) => settlePage(key, secs)}
        onTimeout={(key) => settlePage(key, 'unacked')}
      />
    )}
    {/* ---- Orientation slides: spotlight one region, card parked over a dimmed one ---- */}
    {orientStep && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        // Only the welcome slide gets a backdrop; later slides rely on the
        // region spotlight so the highlighted panel stays fully visible.
        background: orientStep.region === null ? 'rgba(0,0,0,0.45)' : 'transparent',
        pointerEvents: orientStep.region === null ? 'auto' : 'none',
      }}>
        <div style={{ ...PANEL_STYLE, position: 'absolute', pointerEvents: 'auto', ...PLACEMENT_STYLE[orientStep.placement] }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--acc)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {tutorialStep + 1} / {ORIENTATION_STEPS.length}
            </span>
            <div style={{ flex: 1, height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${((tutorialStep + 1) / ORIENTATION_STEPS.length) * 100}%`, height: '100%', background: 'var(--acc)', transition: 'width 0.3s' }} />
            </div>
          </div>
          <h2 style={{ fontSize: 16, color: 'var(--txt-strong)', margin: 0 }}>{orientStep.title}</h2>
          <p style={{ fontSize: 13, color: 'var(--txt)', lineHeight: 1.7, margin: 0 }}>{orientStep.body}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button type="button" onClick={dismissTutorial}
              style={{ fontSize: 12, color: 'var(--txt-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
              skip tutorial
            </button>
            <button type="button" style={BTN_STYLE}
              onClick={() => {
                const next = tutorialStep + 1
                if (next < ORIENTATION_STEPS.length) {
                  setTutorialStep(next)
                } else {
                  dismissTutorial()
                }
              }}>
              {tutorialStep >= ORIENTATION_STEPS.length - 1 ? 'Start playing →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    )}

    <RunLayout
      spotlightRegion={orientStep?.region ?? null}
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
            slaPercent={slaPercent}
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
          {/* Urgency banner: only in non-free-play scenarios where rep=0 ends the game */}
          {repZeroRemaining !== null && state.scenario_id !== 'free-play' && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 800,
              background: 'rgba(220,38,38,0.92)', color: '#fff',
              fontWeight: 700, fontSize: 13, textAlign: 'center',
              padding: '5px 0',
              animation: 'pulse 1s ease-in-out infinite',
            }}>
              REPUTATION AT ZERO — {repZeroRemaining} ticks until game over
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
        <div style={{ display: 'flex', flexDirection: 'row', height: '100%', minHeight: 0 }}>
          {/* ── Incidents column (left) ── */}
          <div style={{ flex: '0 0 50%', minWidth: 0, overflow: 'hidden', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '5px 10px',
              fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
              fontWeight: 600, color: incidents.length > 0 ? 'var(--bad)' : 'var(--txt-faint)',
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
              borderBottom: '1px solid var(--line)',
            }}>
              <span>Incidents</span>
              {incidents.length > 0 && (
                <>
                  <span style={{ background: 'var(--bad)', color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>
                    {incidents.length}
                  </span>
                  <span style={{ color: 'var(--bad)', fontWeight: 400, fontSize: 10 }}>
                    −{(incidents.reduce((s, i) => s + (i.def as any).severity * economy.reputation_decay_per_tick, 0)).toFixed(1)}/t
                  </span>
                </>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <IncidentFeed
                incidents={incidents}
                selectedKey={selectedIncident}
                onSelect={(key) => setSelectedIncident(key === selectedIncident ? null : key)}
                tickSeconds={economy.tick_seconds}
                onPlayAction={(instanceId, actionId, incidentKey) => openMinigame(instanceId, actionId, incidentKey)}
                ackOf={(key) => ackByKey.get(key)}
                blockedReason={(instanceId, actionId) => actionBlockedReason(state, engineCatalog, instanceId, actionId)}
              />
            </div>
          </div>

          {/* ── Tickets column (right) ── */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '5px 10px',
              fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase',
              fontWeight: 600, color: pendingTicketCount > 0 ? 'var(--acc)' : 'var(--txt-faint)',
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
              borderBottom: '1px solid var(--line)',
            }}>
              <span>Tickets</span>
              {pendingTicketCount > 0 && (
                <span style={{
                  background: tickets.some(t => t.overdue) ? 'var(--bad)' : 'var(--acc)',
                  color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 10,
                }}>
                  {pendingTicketCount}
                </span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <TicketFeed
                tickets={tickets}
                selectedKey={selectedTicket}
                onSelect={(id) => setSelectedTicket(id === selectedTicket ? null : id)}
                tickSeconds={economy.tick_seconds}
                hintTarget={(ticketId, actionId) => {
                  const def = engineCatalog.ticketById.get(ticketId) as any
                  return resolveHintTarget(state, engineCatalog, def, actionId)
                }}
                onHintAction={(ticketId, actionId) => {
                  const def = engineCatalog.ticketById.get(ticketId) as any
                  if (!def) return
                  const t = resolveHintTarget(gameRef.current.state, engineCatalog, def, actionId)
                  if (t.instanceId && t.disabledReason === null) {
                    openMinigame(t.instanceId, actionId, `ticket:${ticketId}`)
                  }
                }}
              />
            </div>
          </div>
        </div>
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
          <MinigameOverlay open={Boolean(session)} onDismiss={() => { setSession(null); setSpeed(preMinigameSpeedRef.current) }}>
            {session && (
              <>
                {/* Live reputation ticker — shows the clock is running */}
                {(() => {
                  const rep = Math.round(state.carried.reputation)
                  const lossPerTick = state.incidents.reduce(
                    (s, r) => s + ((engineCatalog.incidentById.get(r.incident_id) as any)?.severity ?? 0) * economy.reputation_decay_per_tick, 0
                  )
                  const repColor = rep >= 70 ? '#22c55e' : rep >= 40 ? '#f59e0b' : '#ef4444'
                  return (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0,
                      padding: '4px 16px',
                      background: 'color-mix(in srgb, var(--bg-0) 90%, transparent)',
                      borderBottom: '1px solid var(--line)',
                      display: 'flex', gap: 16, alignItems: 'center',
                      fontSize: 12, zIndex: 1,
                    }}>
                      <span style={{ color: repColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        REP {rep}%
                      </span>
                      {lossPerTick > 0 && (
                        <span style={{ color: 'var(--warn)', fontWeight: 400 }}>
                          {incidents.length} incident{incidents.length !== 1 ? 's' : ''} active — clock paused
                        </span>
                      )}
                      <span style={{ color: 'var(--ok, #22c55e)', marginLeft: 'auto' }}>
                        ⏸ clock paused
                      </span>
                    </div>
                  )
                })()}
                <MinigameShell
                  session={session}
                  history={history}
                  onAnswerChange={onAnswerChange}
                  onSubmit={onSubmit}
                  onCancel={() => { setSession(null); setSpeed(preMinigameSpeedRef.current) }}
                />
              </>
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
    case 'terminal':
      return { kind: 'terminal', text: '' }
    case 'log_hunt':
      return { kind: 'log_hunt', line: null }
    case 'patch': {
      const given = instance.given as { content: string }
      return { kind: 'patch', content: given.content }
    }
    case 'monitor':
      return { kind: 'monitor', metric: null, t: 0 }
    case 'classify':
      return { kind: 'classify', placements: {} }
    default:
      return { kind: 'evidence', choice: null }
  }
}
