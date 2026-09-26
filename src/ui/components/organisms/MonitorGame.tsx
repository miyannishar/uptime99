import { useState, useEffect, useRef, useCallback } from 'react'
import type { MonitorGiven, MonitorMetric, MonitorSolution } from '../../types'
import { valueAt, crossingTime } from '@engine/monitorCurve'
import { cx } from '../../utils/format'
import s from './MonitorGame.module.css'

export interface MonitorGameProps {
  given: MonitorGiven
  solution: MonitorSolution
  metric: string | null
  /** The last recorded click time; unused in display but part of the answer shape. */
  t?: number
  onChange: (next: { metric: string | null; t: number }) => void
  disabled?: boolean
  revealed?: boolean
  /** Key changes on retry to restart the clock. */
  attemptKey?: number
}

const SPARKLINE_POINTS = 60 // one per ~100ms over 10s for visual smoothness

/**
 * Format I - `monitor`.
 *
 * Live gauge cards drift in real time. The player clicks the right metric
 * inside the window after its threshold crossing. The clock is independent
 * of the game clock and restarts on remount (keyed by attempt number in
 * MinigameShell). A countdown bar shows how much time is left.
 */
export function MonitorGame({
  given,
  solution,
  metric,
  t: _t,
  onChange,
  disabled,
  revealed,
  attemptKey: _attemptKey,
}: MonitorGameProps) {
  const { metrics, duration_s, rule } = given
  const [elapsed, setElapsed] = useState(0)
  const [frozen, setFrozen] = useState(disabled ?? false)
  const [sparklines, setSparklines] = useState<Record<string, number[]>>(() => {
    const init: Record<string, number[]> = {}
    for (const m of metrics) init[m.id] = [valueAt(m, 0)]
    return init
  })

  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const frozenRef = useRef(disabled ?? false)

  // Reset when the component key changes (retry) or when disabled changes
  useEffect(() => {
    frozenRef.current = disabled ?? false
    setFrozen(disabled ?? false)
    if (!disabled) {
      // Restart
      startRef.current = null
      setElapsed(0)
      const init: Record<string, number[]> = {}
      for (const m of metrics) init[m.id] = [valueAt(m, 0)]
      setSparklines(init)
    }
  }, [disabled, metrics])

  const tick = useCallback((now: number) => {
    if (frozenRef.current) return
    if (startRef.current === null) startRef.current = now
    const e = (now - startRef.current) / 1000
    const clamped = Math.min(e, duration_s)
    setElapsed(clamped)

    // Update sparklines: keep the last SPARKLINE_WINDOW_S seconds of values
    setSparklines((prev) => {
      const next: Record<string, number[]> = {}
      for (const m of metrics) {
        const v = valueAt(m, clamped)
        const arr = [...(prev[m.id] ?? []), v]
        next[m.id] = arr.slice(-SPARKLINE_POINTS)
      }
      return next
    })

    if (e >= duration_s) {
      // Time expired — submit blank answer
      frozenRef.current = true
      setFrozen(true)
      onChange({ metric: null, t: duration_s })
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration_s, metrics, onChange])

  useEffect(() => {
    if (disabled) return
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [disabled, tick])

  function handleClick(m: MonitorMetric) {
    if (frozen || disabled) return
    frozenRef.current = true
    setFrozen(true)
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    onChange({ metric: m.id, t: elapsed })
  }

  const progress = duration_s > 0 ? Math.max(0, 1 - elapsed / duration_s) : 0
  const expired = elapsed >= duration_s

  return (
    <div className={s.root}>
      <div className={s.rule}>{rule}</div>

      <div className={s.timerBar} aria-label={`Time remaining: ${Math.ceil(Math.max(0, duration_s - elapsed))} s`}>
        <div
          className={cx(s.timerFill, expired && s.timerFillExpired)}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className={s.gauges}>
        {metrics.map((m) => {
          const currentVal = valueAt(m, elapsed)
          const isSelected = metric === m.id
          const pts = sparklines[m.id] ?? [currentVal]

          // For reveal: compute tStar and draw threshold line hint
          const tStar = revealed
            ? crossingTime(m, solution.threshold, solution.direction, duration_s)
            : null
          const isSolution = revealed && m.id === solution.metric

          return (
            <div
              key={m.id}
              className={cx(
                s.card,
                isSelected && s.cardSelected,
                (frozen || disabled) && s.cardDisabled,
              )}
              onClick={() => handleClick(m)}
              role="button"
              tabIndex={frozen || disabled ? -1 : 0}
              aria-pressed={isSelected}
              aria-label={`${m.label}: ${currentVal.toFixed(1)} ${m.unit}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(m) }}
            >
              <span className={s.metricLabel}>{m.label}</span>
              <span className={s.metricValue}>
                {currentVal.toFixed(1)}
                <span className={s.metricUnit}>{m.unit}</span>
              </span>
              <SparklineSVG points={pts} />
              {revealed && isSolution && tStar !== null && (
                <span className={s.revealLine}>
                  Crosses {solution.direction} {solution.threshold} {m.unit} at t={tStar}s
                </span>
              )}
            </div>
          )
        })}
      </div>

      {!frozen && !disabled && metric === null && (
        <p className={s.hint}>Watch the gauges. Click the metric that crosses the threshold in the rule.</p>
      )}
    </div>
  )
}

/** A minimal inline sparkline rendered as an SVG polyline. */
function SparklineSVG({ points }: { points: number[] }) {
  if (points.length < 2) return <svg className={s.sparkline} />
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const w = 160
  const h = 40
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg
      className={s.sparkline}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="var(--acc)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
