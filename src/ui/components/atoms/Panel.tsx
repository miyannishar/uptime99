import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './Panel.module.css'

export type PanelTone = 'raised' | 'sunken' | 'flush'

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone
  /** CSS colour for the left accent rail, e.g. `layerVar('data')`. */
  accent?: string
  interactive?: boolean
  selected?: boolean
  /**
   * Something is wrong here. In DEPTH this glows and pulses; in FLAT it is a
   * plain red border. Never the sole carrier of that fact - the text inside
   * always says so too.
   */
  alarm?: boolean
  children?: ReactNode
}

/**
 * The one surface primitive. Elevation, hover lift and the alarm pulse all come
 * from depth-controlled tokens, so Panel never branches on the depth mode.
 */
export function Panel({
  tone = 'raised',
  accent,
  interactive,
  selected,
  alarm,
  className,
  children,
  style,
  ...rest
}: PanelProps) {
  return (
    <div
      className={cx(
        s.root,
        tone === 'sunken' && s.sunken,
        tone === 'flush' && s.flush,
        interactive && s.interactive,
        selected && s.selected,
        alarm && s.alarm,
        accent && s.accented,
        className,
      )}
      style={accent ? { ...style, ['--panel-accent' as string]: accent } : style}
      {...rest}
    >
      {children}
    </div>
  )
}
