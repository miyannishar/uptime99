/* Deterministic metric curves for the monitor minigame. The UI animates from the
   same function the grader uses, so what the player sees is what is graded. */
export interface MonitorMetric {
  readonly id: string; readonly label: string; readonly unit: string
  readonly start: number; readonly slope: number; readonly amplitude: number; readonly period_s: number
  /** Optional physical bounds (a queue cannot hold fewer than 0 messages). */
  readonly floor?: number; readonly ceil?: number
}
export function valueAt(m: MonitorMetric, t: number): number {
  const raw = m.start + m.slope * t + m.amplitude * Math.sin((2 * Math.PI * t) / m.period_s)
  return Math.min(m.ceil ?? Infinity, Math.max(m.floor ?? -Infinity, raw))
}
/** First time (0.05 s resolution) the curve crosses threshold in direction, or null. */
export function crossingTime(m: MonitorMetric, threshold: number, direction: 'above' | 'below', durationS: number): number | null {
  for (let t = 0; t <= durationS + 1e-9; t += 0.05) {
    const v = valueAt(m, t)
    if (direction === 'above' ? v >= threshold : v <= threshold) return Math.round(t * 100) / 100
  }
  return null
}
