import type { ReactNode } from 'react'
import {
  Button, CodeBlock, CooldownRing, DifficultyDots, Led, LockBadge, MetricValue, Panel,
  SectionLabel, SeverityBadge, Slider, Sparkline, StatBar, Tag, TierPip, Toggle,
} from '../components/atoms'
import {
  ActionRow, BudgetMeter, IncidentBanner, LedgerRow, MetricTile, NodeCard, PortSlot,
  RackModel3D, RevealPanel, SignalRow, SpeedControl, TagList, TeachesCallout,
  TierLadderRow, WrongOutcomeCard,
} from '../components/molecules'
import {
  catalog, economy, index, layers, offPathLayers, requestPathLayers,
} from '../data/catalog'
import {
  boardNode, ladderFor, portsFor, resolvedActionsFor, sampleBoard, sampleIncidents,
  sampleLedger, sampleMetrics,
} from '../fixtures/sampleRun'
import { layerVar } from '../utils/format'
import s from './Gallery.module.css'

/** Counts CLAUDE.md asserts. A mismatch here means the data moved. */
const EXPECTED = {
  layers: 7, tags: 47, nodes: 26, actions: 33, metrics: 7,
  incidents: 49, formats: 5, minigames: 15, instances: 29,
} as const

function Specimen({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className={s.specimen}>
      <div className={s.specLabel}>
        {label}
        {note && <span className={s.specNote}>{note}</span>}
      </div>
      <div className={s.specBody}>{children}</div>
    </div>
  )
}

export function Gallery() {
  const pg = boardNode('pg-primary')
  const app = boardNode('app-us-01')
  const redis = boardNode('redis-cache')
  const worker = boardNode('worker-01')
  const ci = boardNode('ci-01')

  const appActions = resolvedActionsFor(app)
  const pgActions = resolvedActionsFor(pg)
  const uptime = sampleMetrics.find((m) => m.def.id === 'uptime_pct')!
  const p95 = sampleMetrics.find((m) => m.def.id === 'p95_latency_ms')!
  const instance = catalog.instances[0]

  const counts: Record<string, number> = {
    layers: catalog.layers.length, tags: catalog.tags.length, nodes: catalog.nodes.length,
    actions: catalog.actions.length, metrics: catalog.metrics.length,
    incidents: catalog.incidents.length, formats: catalog.formats.length,
    minigames: catalog.minigames.length, instances: catalog.instances.length,
  }
  const tiers = catalog.nodes.reduce((n, d) => n + d.tiers.length, 0)

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Component library</h1>
        <p className={s.sub}>
          Rendered against the real <code>data/</code> directory. Definitions are never fixtures —
          only instance state is fabricated, because it has no source in <code>data/</code> by design.
        </p>
      </header>

      {/* ---- data coverage ------------------------------------------------ */}
      <section className={s.section}>
        <SectionLabel>Data coverage</SectionLabel>
        <div className={s.grid}>
          {Object.entries(counts).map(([key, got]) => {
            const want = EXPECTED[key as keyof typeof EXPECTED]
            return (
              <div key={key} className={s.cell} data-ok={got === want}>
                <span className={s.k}>{key}</span>
                <span className={s.v}>{got}</span>
                {got !== want && <span className={s.warn}>expected {want}</span>}
              </div>
            )
          })}
          <div className={s.cell} data-ok={tiers === 80}>
            <span className={s.k}>tiers</span>
            <span className={s.v}>{tiers}</span>
            {tiers !== 80 && <span className={s.warn}>expected 80</span>}
          </div>
        </div>
        <p className={s.note}>
          Request path: {requestPathLayers.map((l) => l.name).join(' → ')} · off-path:{' '}
          {offPathLayers.map((l) => l.name).join(', ')}
        </p>
      </section>

      {/* ---- layer palette ----------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside="one accent per layer">Layers</SectionLabel>
        <div className={s.swatches}>
          {layers.map((layer) => (
            <div key={layer.id} className={s.swatch} style={{ ['--layer' as string]: layerVar(layer.id) }}>
              <span className={s.swatchChip} />
              <span className={s.swatchName}>{layer.name}</span>
              <span className={s.swatchMeta}>
                {layer.on_request_path ? `on path · ${layer.layer_index}` : 'off path'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- tags -------------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside={`${catalog.tags.length} across 4 kinds`}>Tags</SectionLabel>
        {(['weakness', 'capability', 'property', 'posture'] as const).map((kind) => {
          const group = catalog.tags.filter((t) => t.kind === kind)
          return (
            <Specimen key={kind} label={kind} note={`${group.length}`}>
              <div className={s.tagWrap}>
                {group.map((tag) => (
                  <Tag key={tag.id} tag={tag} />
                ))}
              </div>
            </Specimen>
          )
        })}
      </section>

      {/* ---- atoms ------------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside="16">Atoms</SectionLabel>

        <Specimen label="StatBar" note="ok · warn · bad · over 100%">
          <div className={s.stack}>
            <StatBar value={92} status="ok" label="ok" />
            <StatBar value={58} status="warn" label="warn" />
            <StatBar value={12} status="bad" label="bad" />
            <StatBar value={137} status="bad" marker={economy.saturation_knee * 100} label="over" />
          </div>
        </Specimen>

        <Specimen label="TierPip" note="pips show remaining headroom">
          <div className={s.row}>
            <TierPip tier={1} max={3} name="Single provider" />
            <TierPip tier={2} max={4} name="Managed" />
            <TierPip tier={3} max={3} name="Anycast" />
          </div>
        </Specimen>

        <Specimen label="SeverityBadge" note="1–5">
          <div className={s.row}>
            {[1, 2, 3, 4, 5].map((n) => (
              <SeverityBadge key={n} severity={n} />
            ))}
            <SeverityBadge severity={4} family="infrastructure" />
          </div>
        </Specimen>

        <Specimen label="MetricValue" note="colour from healthy_range, arrow from direction">
          <div className={s.row}>
            <MetricValue value={uptime.value} def={uptime.def} previous={uptime.previous} size="lg" />
            <MetricValue value={p95.value} def={p95.def} previous={p95.previous} size="md" />
            <MetricValue value={99.99} def={uptime.def} previous={99.9} />
          </div>
        </Specimen>

        <Specimen label="DifficultyDots · CooldownRing · Led · LockBadge">
          <div className={s.row}>
            <DifficultyDots difficulty={1} />
            <DifficultyDots difficulty={3} label="Query Plan" />
            <DifficultyDots difficulty={5} />
            <CooldownRing remainingS={34} totalS={90} />
            <span className={s.row}>
              <Led state="ok" /> <Led state="warn" /> <Led state="bad" /> <Led state="off" />
            </span>
            <LockBadge requirement="tracing at tier 2 or higher" />
          </div>
        </Specimen>

        <Specimen label="Sparkline" note="healthy band shaded behind the line">
          <div className={s.row}>
            <Sparkline series={uptime.series ?? []} status="warn" healthyRange={uptime.def.healthy_range} label="uptime" width={90} height={24} />
            <Sparkline series={p95.series ?? []} status="bad" healthyRange={p95.def.healthy_range} label="p95" width={90} height={24} />
          </div>
        </Specimen>

        <Specimen label="Button · Toggle">
          <div className={s.row}>
            <Button variant="primary">commit</Button>
            <Button>restart</Button>
            <Button variant="danger">restore_from_backup</Button>
            <Button variant="quiet">cancel</Button>
            <Button disabled>on cooldown</Button>
            <Button variant="primary" meta="20s · $60">add_replica</Button>
            <Toggle
              ariaLabel="demo"
              value="b"
              onChange={() => {}}
              options={[
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
                { value: 'c', label: 'C' },
              ]}
            />
          </div>
        </Specimen>

        <Specimen label="Slider" note="the dial primitive">
          <div className={s.narrow}>
            <Slider min={1} max={20} value={5} onChange={() => {}} unit="workers" ariaLabel="workers" />
          </div>
        </Specimen>

        <Specimen label="CodeBlock" note="line numbers · highlight · clickable lines">
          <CodeBlock
            language="yaml"
            lineNumbers
            highlight={[3]}
            code={'apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: 6\n  selector:\n    matchLabels:\n      app: api'}
          />
        </Specimen>

        <Specimen label="Panel" note="raised · sunken · alarm · accented">
          <div className={s.row}>
            <Panel className={s.panelDemo}>raised</Panel>
            <Panel tone="sunken" className={s.panelDemo}>sunken</Panel>
            <Panel alarm className={s.panelDemo}>alarm</Panel>
            <Panel accent={layerVar('data')} className={s.panelDemo}>accent</Panel>
            <Panel interactive selected className={s.panelDemo}>selected</Panel>
          </div>
        </Specimen>
      </section>

      {/* ---- molecules --------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside="17">Molecules</SectionLabel>

        <Specimen label="NodeCard" note="healthy · saturated · down · cold cache · provisioning · compact">
          <div className={s.row}>
            <NodeCard node={boardNode('lb-main')} />
            <NodeCard node={app} saturationKnee={economy.saturation_knee} />
            <NodeCard node={pg} incidentCount={1} />
            <NodeCard node={redis} />
            <NodeCard node={ci} />
            <NodeCard node={boardNode('metrics-01')} compact />
          </div>
        </Specimen>

        <Specimen label="MetricTile" note="technical and business">
          <div className={s.row}>
            {sampleMetrics.slice(0, 4).map((r) => (
              <MetricTile key={r.def.id} reading={r} />
            ))}
          </div>
          <div className={s.row}>
            <MetricTile reading={uptime} showFormula />
          </div>
        </Specimen>

        <Specimen label="ActionRow" note={`real gating — ${appActions.length} match app_cluster T2`}>
          <div className={s.stackTight}>
            {appActions.slice(0, 5).map((a) => (
              <ActionRow key={a.def.id} action={a} onPlay={() => {}} />
            ))}
          </div>
        </Specimen>

        <Specimen label="ActionRow" note={`postgres T1 — ${pgActions.length} match, some resolve the live incident`}>
          <div className={s.stackTight}>
            {pgActions.slice(0, 4).map((a) => (
              <ActionRow key={a.def.id} action={a} onPlay={() => {}} />
            ))}
          </div>
        </Specimen>

        <Specimen label="TagList" note="weaknesses sort first, overflow collapses">
          <div className={s.stack}>
            <TagList tags={pg.tags} />
            <TagList tags={redis.tags} max={2} />
          </div>
        </Specimen>

        <Specimen label="TierLadderRow" note="cost deltas are derived from cost_month, never authored">
          <div className={s.narrowWide}>
            {ladderFor(pg).map((entry) => (
              <TierLadderRow key={entry.tier.tier} entry={entry} capacityUnit={pg.tier.stats.capacity_unit} onUpgrade={() => {}} />
            ))}
          </div>
        </Specimen>

        <Specimen label="SignalRow" note="level 0 always visible; locked levels keep their row">
          <div className={s.narrowWide}>
            {sampleIncidents[0]?.signals.map((sig) => (
              <SignalRow key={sig.level} signal={sig} />
            ))}
          </div>
        </Specimen>

        <Specimen label="PortSlot" note="worker_pool's queue port is required and unwired">
          <div className={s.row}>
            {portsFor(app).slice(0, 2).map((p) => (
              <PortSlot key={p.port.port} fill={p} />
            ))}
            {portsFor(worker).map((p) => (
              <PortSlot key={p.port.port} fill={p} />
            ))}
          </div>
        </Specimen>

        <Specimen label="IncidentBanner" note="scope · survive-only · escalation">
          <div className={s.narrowWide}>
            {sampleIncidents.map((inc) => (
              <IncidentBanner key={inc.key} incident={inc} tickSeconds={economy.tick_seconds} />
            ))}
          </div>
        </Specimen>

        <Specimen label="BudgetMeter · SpeedControl">
          <div className={s.row}>
            <BudgetMeter budget={1240} startingBudget={economy.starting_budget} profitMonth={6600} />
            <BudgetMeter budget={180} startingBudget={economy.starting_budget} profitMonth={-420} pending={90} />
            <SpeedControl speed={1} onChange={() => {}} tick={412} />
          </div>
        </Specimen>

        <Specimen label="RackModel3D" note="DEPTH only — disappears in FLAT, carries no unique information">
          <div className={s.row}>
            <RackModel3D sleds={['ok', 'ok', 'off', 'off', 'ok']} />
            <RackModel3D sleds={['ok', 'bad', 'off', 'off', 'ok']} alarm />
          </div>
        </Specimen>

        {instance && (
          <>
            <Specimen label="TeachesCallout" note={instance.id}>
              <div className={s.narrowWide}>
                <TeachesCallout teaches={instance.teaches} earned />
                <TeachesCallout teaches={instance.teaches} />
              </div>
            </Specimen>

            <Specimen label="WrongOutcomeCard" note="concrete numbers moving the wrong way">
              <div className={s.narrowWide}>
                {instance.wrong_outcomes.map((o, i) => (
                  <WrongOutcomeCard key={i} outcome={o} attempt={i + 1} />
                ))}
              </div>
            </Specimen>

            <Specimen label="RevealPanel" note="explains the mechanism, not the answer">
              <div className={s.narrowWide}>
                <RevealPanel reveal={instance.reveal} />
              </div>
            </Specimen>
          </>
        )}

        <Specimen label="LedgerRow" note="all seven ledger_event_kinds are colour-coded">
          <div className={s.narrowWide}>
            {sampleLedger.map((line, i) => (
              <LedgerRow key={i} line={line} />
            ))}
          </div>
        </Specimen>
      </section>

      <footer className={s.foot}>
        {sampleBoard.length} instances · {index.actionById.size} actions · {index.tagById.size} tags
        loaded from <code>data/</code>
      </footer>
    </div>
  )
}
