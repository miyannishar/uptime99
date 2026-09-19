import type { DepthMode } from '../../types'
import { Toggle } from '../atoms'

export interface DepthToggleProps {
  mode: DepthMode
  onChange: (mode: DepthMode) => void
  /** Adds the AUTO position. Off in the top bar, on in settings. */
  includeAuto?: boolean
}

const OPTIONS = [
  { value: 'flat' as const, label: 'FLAT', title: 'No elevation, glow or motion. The inspector shows the tier ladder instead of the 3D rack.' },
  { value: 'depth' as const, label: 'DEPTH', title: 'Elevation, glowing failures, flowing traffic, and the 3D rack in the inspector.' },
  { value: 'auto' as const, label: 'AUTO', title: 'Follows your system reduced-motion setting.' },
]

/**
 * The visual depth preference.
 *
 * Bundles three things under one label because a player who asks for "2D" wants
 * all of them: board elevation and glow, the 3D rack, and non-essential motion.
 */
export function DepthToggle({ mode, onChange, includeAuto }: DepthToggleProps) {
  return (
    <Toggle
      options={includeAuto ? OPTIONS : OPTIONS.slice(0, 2)}
      value={mode}
      onChange={onChange}
      ariaLabel="Visual depth"
    />
  )
}
