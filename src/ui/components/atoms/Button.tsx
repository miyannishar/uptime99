import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/format'
import s from './Button.module.css'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  /** Right-aligned detail inside the button, e.g. "20s · $60". */
  meta?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'sm',
  meta,
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(s.root, s[variant], s[size], block && s.block, className)}
      {...rest}
    >
      <span className={s.label}>{children}</span>
      {meta && <span className={s.meta}>{meta}</span>}
    </button>
  )
}
