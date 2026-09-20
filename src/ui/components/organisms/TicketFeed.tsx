import type { AdaptedTicket } from '../../adapt'
import { SectionLabel } from '../atoms'
import { formatDuration } from '../../utils/format'
import s from './TicketFeed.module.css'

export interface TicketFeedProps {
  tickets: readonly AdaptedTicket[]
  selectedKey?: string | null
  onSelect?: (ticketId: string) => void
  tickSeconds?: number
  /** Called when player clicks a hint button — should select the relevant node */
  onHintAction?: (ticketId: string, actionId: string) => void
  /** Board nodes, used to check if add_node tickets can be acted on */
  board?: { def: { id: string; name: string } }[]
}

function sevBadgeClass(sev: number): string {
  if (sev >= 3) return s['badge-sev3']
  if (sev >= 2) return s['badge-sev2']
  return s['badge-sev1']
}

export function TicketFeed({
  tickets,
  selectedKey,
  onSelect,
  tickSeconds = 5,
  onHintAction,
  board = [],
}: TicketFeedProps) {
  // Sort: overdue first, then pending, then completed
  const sorted = [...tickets].sort((a, b) => {
    const rank = (t: AdaptedTicket) =>
      t.status === 'overdue' ? 0 : t.status === 'pending' ? 1 : 2
    return rank(a) - rank(b)
  })

  const pendingCount = tickets.filter(t => t.status !== 'completed').length

  return (
    <section className={s.root} aria-label="Active tickets">
      <div className={s.head}>
        <SectionLabel>
          Tickets {pendingCount > 0 ? `· ${pendingCount}` : ''}
        </SectionLabel>
      </div>

      {tickets.length === 0 && (
        <p className={s.quiet}>No active tickets.</p>
      )}

      <ul className={s.list}>
        {sorted.map(ticket => {
          const open = selectedKey === ticket.def.id
          const { def, record, ticksUntilDeadline, overdue, status } = ticket

          // For add_node tickets, check if the required node is on the board
          const isAddNode = def.kind === 'add_node'
          const reqNodeId = def.requirement?.node_id
          const nodeOnBoard = !isAddNode || !reqNodeId || board.some(n => n.def.id === reqNodeId)
          const missingNodeName = !nodeOnBoard ? reqNodeId : undefined

          const chipClass = status === 'completed'
            ? s['chip-completed']
            : status === 'overdue'
            ? s['chip-overdue']
            : s['chip-pending']

          const deadlineClass = status === 'completed'
            ? s['deadline-completed']
            : status === 'overdue'
            ? s['deadline-overdue']
            : s['deadline-pending']

          const absTicks = Math.abs(ticksUntilDeadline)
          const durText = formatDuration(absTicks * tickSeconds)
          const deadlineText = record.completed
            ? `Completed at tick ${record.completion_tick}`
            : overdue
            ? `${durText} overdue`
            : `${durText} left`

          return (
            <li key={def.id} className={s.item}>
              <div
                className={s.card}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => onSelect?.(def.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(def.id) } }}
              >
                {/* Header row */}
                <div className={s['head-row']}>
                  <span
                    className={`${s.badge} ${sevBadgeClass(def.severity)}`}
                    title={`Severity ${def.severity}`}
                    aria-label={`Severity ${def.severity}`}
                  />
                  <span className={s.name}>{def.name}</span>
                  <span className={`${s.chip} ${chipClass}`}>
                    {status === 'completed' ? 'Done' : status === 'overdue' ? 'Overdue' : 'Pending'}
                  </span>
                </div>

                {/* Deadline row */}
                <p className={`${s.deadline} ${deadlineClass}`}>
                  {deadlineText}
                </p>

                {/* Rep drain when overdue */}
                {overdue && !record.completed && (
                  <p className={s['rep-drain']}>
                    −{def.reputation_penalty_per_tick}/tick reputation drain
                  </p>
                )}

                {/* Expanded content */}
                {open && (
                  <>
                    {/* Blurb */}
                    <p className={s.blurb}>{def.blurb}</p>

                    {/* Completion note */}
                    {record.completed && record.completion_tick !== null && (
                      <p className={s['completion-note']}>
                        ✓ Completed at tick {record.completion_tick}
                      </p>
                    )}

                    {/* Hint buttons */}
                    {!record.completed && def.hint_actions && def.hint_actions.length > 0 && (
                      <div className={s.hints}>
                        <span className={s['hints-label']}>hint actions</span>

                        {!nodeOnBoard && (
                          <p className={s['node-missing']}>
                            Add {missingNodeName ?? 'the required node'} to your board first
                          </p>
                        )}
                        <div className={s['hint-btns']}>
                          {(def.hint_actions as string[]).map((actionId: string) => (
                            <button
                              key={actionId}
                              type="button"
                              className={s['hint-btn']}
                              disabled={!nodeOnBoard || !onHintAction}
                              title={!nodeOnBoard
                                ? 'Provisioning not yet implemented — add the node to your board first'
                                : onHintAction ? `Hint: ${actionId}` : 'Not available'}
                              onClick={e => {
                                e.stopPropagation()
                                onHintAction?.(def.id, actionId)
                              }}
                            >
                              {actionId}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
