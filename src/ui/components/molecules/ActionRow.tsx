import type { ResolvedAction } from '../../types'
import { CooldownRing, DifficultyDots } from '../atoms'
import { cx, formatDuration, formatMoney } from '../../utils/format'
import s from './ActionRow.module.css'

export interface ActionRowProps {
  action: ResolvedAction
  onPlay?: (actionId: string) => void
  /** Hides the minigame + difficulty line. Used by the command palette. */
  dense?: boolean
}

/**
 * One playable action.
 *
 * Every action carries a `minigame` and a `difficulty`, both required by the
 * schema, so the row always states which puzzle the player is about to face and
 * how hard it is. Committing to an action is committing to that puzzle — hiding
 * it would make the cost of acting unknowable.
 */
export function ActionRow({ action, onPlay, dense }: ActionRowProps) {
  const { def, minigame, availability, cooldownRemainingS, blockedReason, effectiveMoneyCost } = action
  const disabled = availability !== 'ready'
  const premium = effectiveMoneyCost > def.money_cost

  return (
    <button
      type="button"
      className={cx(s.root, disabled && s.disabled, action.resolvesActiveIncident && s.resolves)}
      disabled={disabled || !onPlay}
      onClick={onPlay ? () => onPlay(def.id) : undefined}
      title={def.description}
    >
      <span className={s.main}>
        <span className={s.nameRow}>
          <span className={s.chevron} aria-hidden="true">
            ▸
          </span>
          <span className={s.name}>{def.name}</span>
          {action.resolvesActiveIncident && (
            <span className={s.fixes} title="Resolves an incident currently on this node">
              resolves
            </span>
          )}
          {action.fromActionsExtra && (
            <span className={s.extra} title="Offered by this tier's actions_extra">
              tier-only
            </span>
          )}
        </span>

        {!dense && (
          <span className={s.sub}>
            <DifficultyDots difficulty={def.difficulty} label={minigame.name} />
          </span>
        )}

        {disabled && blockedReason && <span className={s.blocked}>{blockedReason}</span>}
      </span>

      <span className={s.costs}>
        <span className={s.cost}>{formatDuration(def.time_cost_s)}</span>
        <span className={cx(s.cost, premium && s.premium)}>
          {effectiveMoneyCost === 0 ? 'free' : formatMoney(effectiveMoneyCost)}
          {premium && <span className={s.premiumMark} title="Emergency premium applied">!</span>}
        </span>
        {availability === 'cooldown' && (
          <span className={s.cooldown}>
            <CooldownRing remainingS={cooldownRemainingS} totalS={def.cooldown_s} />
            {formatDuration(cooldownRemainingS)}
          </span>
        )}
      </span>
    </button>
  )
}
