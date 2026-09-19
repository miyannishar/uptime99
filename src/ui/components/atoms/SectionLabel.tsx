import type { ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './SectionLabel.module.css'

export interface SectionLabelProps {
  children: ReactNode
  /** Right-aligned detail, e.g. a count or a total. */
  aside?: ReactNode
  rule?: boolean
}

/** Small uppercase divider label used throughout the inspector and panels. */
export function SectionLabel({ children, aside, rule }: SectionLabelProps) {
  return (
    <div className={cx(s.root, rule && s.rule)}>
      <span className={s.text}>{children}</span>
      {aside && <span className={s.aside}>{aside}</span>}
    </div>
  )
}
