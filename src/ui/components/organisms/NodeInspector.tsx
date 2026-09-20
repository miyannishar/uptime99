import type {
  ActiveIncident, BoardNode, PortFill, ResolvedAction, TierLadderEntry,
} from '../../types'
import type { LedState } from '../atoms'
import { SectionLabel, StatBar } from '../atoms'
import {
  ActionRow, PortSlot, RackModel3D, TagList, TierLadderRow,
} from '../molecules'
import {
  cx, formatCostVariable, formatDuration, formatStat, healthStatus, layerVar,
  statLabel, utilisationStatus,
} from '../../utils/format'
import s from './NodeInspector.module.css'

export interface NodeInspectorProps {
  node: BoardNode
  /** Already gated by `constraint` - the inspector only renders. */
  actions: readonly ResolvedAction[]
  ladder: readonly TierLadderEntry[]
  ports: readonly PortFill[]
  incidents?: readonly ActiveIncident[]
  nameOf?: (instanceId: string) => string
  onPlayAction?: (actionId: string) => void
  onUpgradeTier?: (tier: number) => void
  /** Plain-language condition, e.g. "host fault · sled 2 failed · no replica". */
  conditionNote?: string
  /** One entry per rack sled. Decorative - mirrors `conditionNote`. */
  sleds?: readonly LedState[]
  saturationKnee?: number
}

/** Universal stats first, in the order the schema requires them. */
const UNIVERSAL = [
  'capacity', 'base_latency_ms', 'availability_pct', 'cost_month',
  'provision_time_s', 'blast_radius',
] as const

/**
 * Everything about one node, and everything the player can do to it.
 *
 * The section order is the argument: state → stats → upgrade path → tags →
 * wiring → actions. Reading state before acting is the habit the game is trying
 * to build, so the actions sit at the bottom rather than the top.
 *
 * Note what does NOT happen here: this component never evaluates a `constraint`,
 * resolves a `def_id`, or computes a cooldown. It is handed `ResolvedAction[]`
 * and renders them, which is what lets the engine attach later without changing
 * a line of this file.
 */
export function NodeInspector({
  node,
  actions,
  ladder,
  ports,
  incidents = [],
  nameOf = (id) => id,
  onPlayAction,
  onUpgradeTier,
  conditionNote,
  sleds,
  saturationKnee = 0.8,
}: NodeInspectorProps) {
  const { def, tier, inst, layer, tags } = node
  const stats = tier.stats
  const domainKeys = Object.keys(stats).filter(
    (k) => !UNIVERSAL.includes(k as (typeof UNIVERSAL)[number]) && k !== 'capacity_unit',
  )
  const ready = actions.filter((a) => a.availability === 'ready')

  return (
    <aside className={s.root} aria-label={`${def.name} inspector`}>
      {/* ---- identity ---------------------------------------------------- */}
      <header className={s.head} style={{ ['--layer' as string]: layerVar(layer.id) }}>
        <div className={s.titleRow}>
          <h2 className={s.title}>{def.name}</h2>
          <span className={s.layerChip}>{layer.name}</span>
        </div>
        <p className={s.sub}>
          <span className={s.instId}>{inst.instance_id}</span>
          {' · '}tier {inst.tier} - {tier.name}
          {' · '}{inst.region}
        </p>
        <p className={s.desc}>{def.description}</p>
      </header>

      {/* ---- condition --------------------------------------------------- */}
      <section className={s.section}>
        <div className={s.condition}>
          <div className={s.conditionRow}>
            <span className={s.k}>health</span>
            <span className={cx(s.v, inst.down && s.bad)}>
              {inst.down ? '0 · DOWN' : Math.round(inst.health)}
            </span>
          </div>
          <StatBar
            value={inst.down ? 0 : inst.health}
            status={healthStatus(inst.health, inst.down)}
            size="md"
            label={`health ${Math.round(inst.health)} of 100`}
          />
          <div className={s.conditionRow}>
            <span className={s.k}>utilisation</span>
            <span
              className={cx(
                s.v,
                utilisationStatus(inst.utilization_pct, saturationKnee) !== 'ok' && s.warn,
              )}
            >
              {Math.round(inst.utilization_pct)}%
            </span>
          </div>
          <StatBar
            value={inst.utilization_pct}
            status={utilisationStatus(inst.utilization_pct, saturationKnee)}
            marker={saturationKnee * 100}
            size="md"
            label={`utilisation ${Math.round(inst.utilization_pct)} percent`}
          />
          {/* `down` and `health: 0` are different situations; spell out which. */}
          {inst.down && (
            <p className={s.note}>
              Unreachable - no traffic is being routed here. Costs {stats.blast_radius.toFixed(2)} of
              total uptime while it stays down.
            </p>
          )}
          {!inst.down && inst.health === 0 && (
            <p className={s.note}>
              Up but failing: still accepting traffic and returning errors. Still counts toward
              uptime.
            </p>
          )}
          {conditionNote && <p className={s.conditionNote}>{conditionNote}</p>}
          {node.provisioningTicksLeft !== null && node.provisioningTicksLeft > 0 && (
            <p className={s.note}>
              Provisioning - {formatDuration(node.provisioningTicksLeft * 5)} remaining.
            </p>
          )}
        </div>
      </section>

      {/* ---- rack (DEPTH only) + stats ---------------------------------- */}
      <section className={s.section}>
        <SectionLabel aside={!node.onRequestPath ? 'off the request path' : undefined}>
          Tier {inst.tier} stats
        </SectionLabel>
        <div className={s.statsRow}>
          {sleds && sleds.length > 0 && <RackModel3D sleds={sleds} alarm={inst.down} />}
          <dl className={s.stats}>
            {UNIVERSAL.map((key) => (
              <div className={s.stat} key={key}>
                <dt className={s.k}>{statLabel(key)}</dt>
                <dd className={s.v}>
                  {formatStat(key, stats[key] ?? null, stats.capacity_unit)}
                </dd>
              </div>
            ))}
            {domainKeys.map((key) => (
              <div className={s.stat} key={key}>
                <dt className={s.k}>{statLabel(key)}</dt>
                <dd className={s.v}>
                  {formatStat(
                    key,
                    (stats as unknown as Record<string, number | string | null>)[key] ?? null,
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Usage-based rates, where the node has them. */}
        {tier.cost_variable && (
          <div className={s.variable}>
            <span className={s.variableLabel}>usage rates</span>
            {Object.entries(tier.cost_variable).map(([key, rate]) => (
              <span className={s.variableItem} key={key}>
                {statLabel(key)} {formatCostVariable(key, rate as number)}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ---- tier ladder ------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside="cost of the next nine">
          Upgrade path
        </SectionLabel>
        <div className={s.ladder}>
          {ladder.map((entry) => (
            <TierLadderRow
              key={entry.tier.tier}
              entry={entry}
              capacityUnit={stats.capacity_unit}
              onUpgrade={onUpgradeTier}
            />
          ))}
        </div>
      </section>

      {/* ---- tags -------------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside={`${tags.length}`}>Tags</SectionLabel>
        {tags.length > 0 ? <TagList tags={tags} /> : <p className={s.none}>none</p>}
      </section>

      {/* ---- wiring ------------------------------------------------------ */}
      {(ports.length > 0 || def.provides.length > 0) && (
        <section className={s.section}>
          <SectionLabel
            rule
            aside={def.overridable_edges ? 'rewirable' : 'fixed wiring'}
          >
            Wiring
          </SectionLabel>
          {def.provides.length > 0 && (
            <p className={s.provides}>
              provides <b>{def.provides.join(' · ')}</b>
            </p>
          )}
          <div className={s.ports}>
            {ports.map((fill) => (
              <PortSlot key={fill.port.port} fill={fill} nameOf={nameOf} />
            ))}
          </div>
        </section>
      )}

      {/* ---- active incidents ------------------------------------------- */}
      {incidents.length > 0 && (
        <section className={s.section}>
          <SectionLabel rule>On this node</SectionLabel>
          <ul className={s.incidents}>
            {incidents.map((inc) => (
              <li key={inc.key} className={s.incidentItem}>
                <span className={s.incidentName}>{inc.def.name}</span>
                <span className={s.incidentSev}>sev {inc.def.severity}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- actions ----------------------------------------------------- */}
      <section className={s.section}>
        <SectionLabel rule aside={`${ready.length} of ${actions.length} playable`}>
          Actions
        </SectionLabel>
        <div className={s.actions}>
          {actions.length === 0 && <p className={s.none}>nothing applies to this tier</p>}
          {actions.map((action) => (
            <ActionRow key={action.def.id} action={action} onPlay={onPlayAction} />
          ))}
        </div>
      </section>
    </aside>
  )
}
