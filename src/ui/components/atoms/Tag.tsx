import type { TagDef, TagKind } from '../../types'
import { cx } from '../../utils/format'
import s from './Tag.module.css'

export interface TagProps {
  /** Pass the full TagDef where you have it - the kind drives the colour. */
  tag?: TagDef
  /** Fallback for rendering a bare id (e.g. an unresolved `tags_add` entry). */
  id?: string
  kind?: TagKind
  /** Marks the tag as applied by an incident rather than by the definition. */
  runtime?: boolean
  /** Strikethrough - used to preview `on_success.tags_remove`. */
  removed?: boolean
  size?: 'xs' | 'sm'
  onClick?: () => void
}

/**
 * A tag chip. Colour comes from `kind` (weakness / capability / property /
 * posture), so a player learns to read red as "this is what gets exploited"
 * and green as "this is what protects me".
 */
export function Tag({ tag, id, kind, runtime, removed, size = 'xs', onClick }: TagProps) {
  const resolvedKind = tag?.kind ?? kind ?? 'property'
  const text = tag?.id ?? id ?? ''
  const isRuntime = runtime ?? tag?.runtime_only ?? false
  const Element = onClick ? 'button' : 'span'

  return (
    <Element
      className={cx(s.root, s[resolvedKind], size === 'sm' && s.sm, removed && s.removed)}
      title={tag ? `${tag.label} - ${tag.description}` : text}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {isRuntime && <span className={s.runtime} aria-hidden="true">◈</span>}
      {text}
    </Element>
  )
}
