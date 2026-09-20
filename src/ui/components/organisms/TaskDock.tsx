import { useState } from 'react'
import type { ActionDef, BoardNode, LedgerLine } from '../../types'
import { CooldownRing, StatBar } from '../atoms'
import { LedgerRow } from '../molecules'
import { cx, formatDuration, formatMoney, ratio } from '../../utils/format'
import { useResizableLayout, type DockPanel } from '../../hooks/useResizableLayout'
import s from './TaskDock.module.css'

export interface DockProvisioning {
  node: BoardNode
  ticksLeft: number
}

export interface DockCooldown {
  node: BoardNode
  action: ActionDef
  remainingS: number
}

export interface TaskDockProps {
  provisioning: readonly DockProvisioning[]
  cooldowns: readonly DockCooldown[]
  ledger: readonly LedgerLine[]
  tickSeconds?: number
  onSelectNode?: (instanceId: string) => void
}

export function TaskDock({
  provisioning,
  cooldowns,
  ledger,
  tickSeconds = 5,
  onSelectNode,
}: TaskDockProps) {
  const [open, setOpen] = useState(true)
  const { layout, startPanelDrag } = useResizableLayout()
  const recent = [...ledger].reverse()
  const total = provisioning.length + cooldowns.length

  const panels: Record<DockPanel, React.ReactNode> = {
    provisioning: (
      <div
        key="provisioning"
        className={cx(s.group, s.draggableGroup)}
        onMouseDown={e => startPanelDrag('provisioning', e)}
      >
        <div className={cx(s.groupHead, s.dragHandle)}>
          <span className={s.dragDots}>⠿</span>
          Provisioning
          <span className={s.groupCount}>{provisioning.length}</span>
        </div>
        <div className={s.groupBody}>
          {provisioning.length === 0 && <p className={s.none}>nothing being built</p>}
          {provisioning.map(({ node, ticksLeft }) => {
            const totalS = node.tier.stats.provision_time_s
            const leftS = ticksLeft * tickSeconds
            return (
              <button
                key={node.inst.instance_id}
                type="button"
                className={s.task}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => onSelectNode?.(node.inst.instance_id)}
              >
                <span className={s.taskTop}>
                  <span className={s.taskName}>{node.def.name}</span>
                  <span className={s.taskTime}>{formatDuration(leftS)}</span>
                </span>
                <StatBar
                  value={(1 - ratio(leftS, 0, totalS || leftS || 1)) * 100}
                  status="ok"
                  label={`${node.def.name} provisioning, ${formatDuration(leftS)} left`}
                />
                <span className={s.taskMeta}>tier {node.inst.tier} · {node.inst.region}</span>
              </button>
            )
          })}
        </div>
      </div>
    ),
    cooldowns: (
      <div
        key="cooldowns"
        className={cx(s.group, s.draggableGroup)}
        onMouseDown={e => startPanelDrag('cooldowns', e)}
      >
        <div className={cx(s.groupHead, s.dragHandle)}>
          <span className={s.dragDots}>⠿</span>
          Cooling down
          <span className={s.groupCount}>{cooldowns.length}</span>
        </div>
        <div className={s.groupBody}>
          {cooldowns.length === 0 && <p className={s.none}>every action is available</p>}
          {cooldowns.map(({ node, action, remainingS }) => (
            <button
              key={`${node.inst.instance_id}:${action.id}`}
              type="button"
              className={cx(s.task, s.taskRow)}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => onSelectNode?.(node.inst.instance_id)}
            >
              <CooldownRing remainingS={remainingS} totalS={action.cooldown_s ?? remainingS} />
              <span className={s.taskName}>{(action as any).name ?? action.id}</span>
              <span className={s.taskOn}>on {node.inst.instance_id}</span>
              <span className={s.taskTime}>{formatDuration(remainingS)}</span>
            </button>
          ))}
        </div>
      </div>
    ),
    ledger: (
      <div
        key="ledger"
        className={cx(s.group, s.groupWide, s.draggableGroup)}
        onMouseDown={e => startPanelDrag('ledger', e)}
      >
        <div className={cx(s.groupHead, s.dragHandle)}>
          <span className={s.dragDots}>⠿</span>
          Recent charges
          <span className={s.groupCount}>
            {formatMoney(ledger.reduce((n, l) => n + l.amount, 0), { sign: true })}
          </span>
        </div>
        <div className={s.groupBody}>
          {recent.length === 0 && <p className={s.none}>no priced events yet</p>}
          {recent.slice(0, 8).map((line, i) => (
            <LedgerRow key={`${line.tick}-${line.kind}-${i}`} line={line} />
          ))}
        </div>
      </div>
    ),
  }

  return (
    <section className={cx(s.root, !open && s.collapsed)} aria-label="Work in flight">
      <button
        type="button"
        className={s.handle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={s.chevron} aria-hidden="true">{open ? '▾' : '▴'}</span>
        <span className={s.handleLabel}>In flight</span>
        {total > 0 && <span className={s.count}>{total}</span>}
        {!open && recent[0] && (
          <span className={s.peek}>
            last: {recent[0].label} {formatMoney(recent[0].amount, { sign: true })}
          </span>
        )}
      </button>

      {open && (
        <div className={s.columns}>
          {layout.dockOrder.map(key => panels[key])}
        </div>
      )}
    </section>
  )
}
