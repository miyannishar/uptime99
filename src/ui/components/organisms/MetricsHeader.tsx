import type { DepthMode, MetricReading } from '../../types'
import { BudgetMeter, DepthToggle, MetricTile, SpeedControl } from '../molecules'
import type { Speed } from '../molecules'
import s from './MetricsHeader.module.css'

export interface MetricsHeaderProps {
  readings: readonly MetricReading[]
  tick: number
  tickSeconds: number
  speed: Speed
  onSpeedChange: (speed: Speed) => void
  budget: number
  startingBudget: number
  depthMode: DepthMode
  onDepthChange: (mode: DepthMode) => void
  onOpenPalette?: () => void
  /** Live SLA: % of ticks with rep >= 70. null before run starts. */
  slaPercent?: number | null
}

/**
 * The always-visible metric strip.
 *
 * Technical metrics come first and business metrics second, which is the causal
 * order the model actually works in: `users` is derived from the technical
 * metrics, `cost_month` from the instances, and `profit_month` from both. A
 * player who reads left to right reads cause before effect.
 */
export function MetricsHeader({
  readings,
  tick,
  tickSeconds,
  speed,
  onSpeedChange,
  budget,
  startingBudget,
  depthMode,
  onDepthChange,
  onOpenPalette,
  slaPercent,
}: MetricsHeaderProps) {
  const technical = readings.filter((r) => r.def.kind === 'technical')
  const business = readings.filter((r) => r.def.kind === 'business')
  const profit = business.find((r) => r.def.id === 'profit_month')

  return (
    <header className={s.root}>
      <div className={s.group}>
        {technical.map((r) => (
          <MetricTile key={r.def.id} reading={r} inline />
        ))}
      </div>

      <span className={s.divider} aria-hidden="true" />

      <div className={s.group}>
        {business.map((r) => (
          <MetricTile key={r.def.id} reading={r} inline />
        ))}
      </div>

      <span className={s.spacer} />

      {slaPercent !== null && slaPercent !== undefined && (
        <span
          title="SLA score: % of ticks with reputation ≥ 70"
          style={{
            fontSize: '11px',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em',
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid',
            borderColor: slaPercent >= 90 ? 'var(--ok,#22c55e)' : slaPercent >= 70 ? 'var(--warn,#f59e0b)' : 'var(--bad)',
            color: slaPercent >= 90 ? 'var(--ok,#22c55e)' : slaPercent >= 70 ? 'var(--warn,#f59e0b)' : 'var(--bad)',
            background: 'transparent',
            whiteSpace: 'nowrap',
          }}
        >
          SLA {slaPercent}%
        </span>
      )}

      <BudgetMeter
        budget={budget}
        startingBudget={startingBudget}
        profitMonth={profit?.value}
        compact
      />

      <SpeedControl speed={speed} onChange={onSpeedChange} tick={tick} tickSeconds={tickSeconds} />

      {onOpenPalette && (
        <button type="button" className={s.palette} onClick={onOpenPalette} title="Command palette">
          ⌘K
        </button>
      )}

      <DepthToggle mode={depthMode} onChange={onDepthChange} />
    </header>
  )
}
