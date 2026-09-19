import type { TagDef, TagKind } from '../../types'
import { Tag } from '../atoms'
import { cx } from '../../utils/format'
import s from './TagList.module.css'

export interface TagListProps {
  tags: readonly TagDef[]
  /** Collapse past this many into a "+n" chip. */
  max?: number
  className?: string
  onTagClick?: (tag: TagDef) => void
}

/** Weaknesses first — they are what the player has to act on. */
const KIND_ORDER: Record<TagKind, number> = {
  weakness: 0,
  posture: 1,
  capability: 2,
  property: 3,
}

export function TagList({ tags, max, className, onTagClick }: TagListProps) {
  const sorted = [...tags].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  )
  const shown = max ? sorted.slice(0, max) : sorted
  const hidden = sorted.length - shown.length

  return (
    <div className={cx(s.root, className)}>
      {shown.map((tag) => (
        <Tag key={tag.id} tag={tag} onClick={onTagClick ? () => onTagClick(tag) : undefined} />
      ))}
      {hidden > 0 && (
        <span className={s.more} title={sorted.slice(shown.length).map((t) => t.id).join(', ')}>
          +{hidden}
        </span>
      )}
    </div>
  )
}
