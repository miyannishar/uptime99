import { useMemo, useState } from 'react'
import type { LayerDef, NodeDef, TagDef } from '../../types'
import { Button, SectionLabel, TierPip } from '../atoms'
import { TagList } from '../molecules'
import {
  cx, formatCapacity, formatMoney, layerVar,
} from '../../utils/format'
import s from './CatalogDrawer.module.css'

export interface CatalogDrawerProps {
  /** All 26 node definitions. */
  nodes: readonly NodeDef[]
  layers: readonly LayerDef[]
  /** Resolves a tag id from a tier's `tags`. */
  tagById: ReadonlyMap<string, TagDef>
  /** How many of each def are already on the board, for `max_instances`. */
  placedCounts?: Readonly<Record<string, number>>
  budget: number
  onAdd?: (defId: string, tier: number) => void
}

/**
 * The design-phase catalog.
 *
 * Two constraints from the node definitions are enforced visually rather than
 * being left to fail later: `singleton`/`max_instances` greys out a node that is
 * already placed as many times as it may be, and the tier row shows what each
 * rung costs before the player commits. The tier's weakness tags are shown too —
 * buying tier 1 postgres means buying `spof`, and the player should see that at
 * purchase time rather than discover it when an incident exploits it.
 */
export function CatalogDrawer({
  nodes,
  layers,
  tagById,
  placedCounts = {},
  budget,
  onAdd,
}: CatalogDrawerProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return layers.map((layer) => ({
      layer,
      items: nodes.filter(
        (n) =>
          n.layer === layer.id &&
          (!q ||
            n.id.includes(q) ||
            n.name.toLowerCase().includes(q) ||
            n.role.includes(q) ||
            n.provides.some((p) => p.includes(q))),
      ),
    }))
  }, [nodes, layers, query])

  return (
    <div className={s.root}>
      <div className={s.head}>
        <SectionLabel aside={`${nodes.length} components`}>Catalog</SectionLabel>
        <input
          className={s.search}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="filter by name, role or capability…"
          aria-label="Filter catalog"
        />
      </div>

      <div className={s.groups}>
        {grouped.map(({ layer, items }) => {
          if (items.length === 0) return null
          return (
            <section key={layer.id} className={s.group}>
              <header className={s.groupHead} style={{ ['--layer' as string]: layerVar(layer.id) }}>
                <span className={s.groupName}>{layer.name}</span>
                <span className={s.groupDesc}>{layer.description}</span>
              </header>

              {items.map((def) => {
                const placed = placedCounts[def.id] ?? 0
                const full = placed >= def.max_instances
                const open = openId === def.id
                return (
                  <div key={def.id} className={cx(s.node, full && s.full)}>
                    <button
                      type="button"
                      className={s.nodeHead}
                      onClick={() => setOpenId(open ? null : def.id)}
                      aria-expanded={open}
                    >
                      <span className={s.nodeName}>{def.name}</span>
                      <span className={s.nodeRole}>{def.role.replace(/_/g, ' ')}</span>
                      <span className={s.nodeMeta}>
                        {def.singleton && <span className={s.singleton}>singleton</span>}
                        {placed > 0 && (
                          <span className={s.placed}>
                            {placed}/{def.max_instances}
                          </span>
                        )}
                        <TierPip tier={1} max={def.tiers.length} compact />
                      </span>
                    </button>

                    {open && (
                      <div className={s.body}>
                        <p className={s.desc}>{def.description}</p>

                        {def.provides.length > 0 && (
                          <p className={s.line}>
                            provides <b>{def.provides.join(' · ')}</b>
                          </p>
                        )}
                        {def.requires.length > 0 && (
                          <p className={s.line}>
                            requires{' '}
                            {def.requires
                              .map((p) => `${p.port} (${p.min}–${p.max})`)
                              .join(' · ')}
                          </p>
                        )}

                        <div className={s.tiers}>
                          {def.tiers.map((t) => {
                            const affordable = t.stats.cost_month <= budget
                            const weaknesses = t.tags
                              .map((id) => tagById.get(id))
                              .filter((x): x is TagDef => x?.kind === 'weakness')
                            return (
                              <div key={t.tier} className={s.tier}>
                                <span className={s.tierId}>T{t.tier}</span>
                                <span className={s.tierName}>{t.name}</span>
                                <span className={s.tierStats}>
                                  {formatCapacity(t.stats.capacity, t.stats.capacity_unit)}
                                  {' · '}
                                  {t.stats.availability_pct.toFixed(2)}%
                                </span>
                                <span className={cx(s.tierCost, !affordable && s.tooDear)}>
                                  {formatMoney(t.stats.cost_month)}/mo
                                </span>
                                {weaknesses.length > 0 && (
                                  <TagList tags={weaknesses} max={2} className={s.tierTags} />
                                )}
                                <Button
                                  variant={affordable && !full ? 'primary' : 'ghost'}
                                  disabled={!affordable || full || !onAdd}
                                  onClick={() => onAdd?.(def.id, t.tier)}
                                >
                                  {full ? 'max' : affordable ? 'add' : 'too dear'}
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
