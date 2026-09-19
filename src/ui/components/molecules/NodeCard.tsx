import type { BoardNode } from '../../types'
import { Panel, StatBar, TierPip } from '../atoms'
import { TagList } from './TagList'
import {
  cx, formatCapacity, formatDuration, healthStatus, layerVar, utilisationStatus,
} from '../../utils/format'
import s from './NodeCard.module.css'

export interface NodeCardProps {
  node: BoardNode
  selected?: boolean
  onSelect?: (instanceId: string) => void
  /** How many active incidents sit on this instance. */
  incidentCount?: number
  /** `economy.saturation_knee` — where utilisation starts to hurt. */
  saturationKnee?: number
  /** Hides tags and capacity. Used in the off-path tray. */
  compact?: boolean
  /** Max weakness/other tags to show before collapsing to "+n". */
  maxTags?: number
}

/**
 * One node on the board.
 *
 * Shows, in priority order, the three things that decide whether the player
 * should act on it: whether it is reachable (`down`), how loaded it is
 * (`utilization_pct`), and what weaknesses it carries. `down` is rendered as
 * literal text, never only as a colour — `uptime_pct` reads `down` and not
 * `health`, so a node at health 0 that is still up is a genuinely different
 * situation and has to look different.
 */
export function NodeCard({
  node,
  selected,
  onSelect,
  incidentCount = 0,
  saturationKnee = 0.8,
  compact,
  maxTags = 3,
}: NodeCardProps) {
  const { def, tier, inst, layer, tags } = node
  const provisioning = node.provisioningTicksLeft !== null && node.provisioningTicksLeft > 0
  const utilStatus = utilisationStatus(inst.utilization_pct, saturationKnee)

  return (
    <Panel
      className={cx(s.root, compact && s.compact)}
      accent={layerVar(layer.id)}
      interactive={Boolean(onSelect)}
      selected={selected}
      alarm={inst.down}
      onClick={onSelect ? () => onSelect(inst.instance_id) : undefined}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(inst.instance_id)
              }
            }
          : undefined
      }
    >
      <div className={s.head}>
        <span className={cx(s.name, inst.down && s.nameDown)}>{def.name}</span>
        <TierPip tier={inst.tier} max={def.tiers.length} name={tier.name} compact />
      </div>

      {/* One line that states the node's condition in words. */}
      <div className={s.state}>
        {inst.down ? (
          <span className={s.down}>DOWN · br {tier.stats.blast_radius.toFixed(2)}</span>
        ) : provisioning ? (
          <span className={s.provisioning}>
            provisioning {formatDuration((node.provisioningTicksLeft ?? 0) * 5)}
          </span>
        ) : (
          <>
            <span className={cx(s.util, utilStatus === 'bad' && s.utilBad, utilStatus === 'warn' && s.utilWarn)}>
              {Math.round(inst.utilization_pct)}%
            </span>
            {!compact && (
              <span className={s.cap}>{formatCapacity(tier.stats.capacity, tier.stats.capacity_unit)}</span>
            )}
          </>
        )}
      </div>

      <StatBar
        value={inst.down ? 0 : inst.health}
        status={healthStatus(inst.health, inst.down)}
        label={`${def.name} health ${Math.round(inst.health)} of 100`}
      />

      {!compact && tags.length > 0 && <TagList tags={tags} max={maxTags} className={s.tags} />}

      {incidentCount > 0 && (
        <span className={s.incident} title={`${incidentCount} active incident(s)`}>
          {incidentCount > 1 ? `⚠ ${incidentCount}` : '⚠'}
        </span>
      )}

      {/* Off-path nodes never enter the p95 sum; say so rather than imply it. */}
      {!node.onRequestPath && !compact && <span className={s.offPath}>off-path</span>}
    </Panel>
  )
}
