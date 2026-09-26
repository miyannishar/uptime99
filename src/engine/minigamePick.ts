/* Deterministic minigame choice for an action. Pure: same (seed, action, context)
   always yields the same slot and instance, so a run replays exactly, while
   different incidents/tickets see different puzzles. */

import { seedFrom } from './rng'

export interface MinigameSlot { readonly minigame: string; readonly difficulty: number }

interface PoolAction {
  readonly minigame: string
  readonly difficulty: number
  readonly minigame_pool?: readonly MinigameSlot[]
}

/** Slot 0 is the action's own minigame/difficulty; the pool adds alternatives. */
export function slotsFor(action: PoolAction): MinigameSlot[] {
  return [{ minigame: action.minigame, difficulty: action.difficulty }, ...(action.minigame_pool ?? [])]
}

export function pickSlot(action: PoolAction & { readonly id: string }, contextKey: string, rngSeed: number): MinigameSlot {
  const slots = slotsFor(action)
  return slots[seedFrom(`${rngSeed}:${action.id}:${contextKey}`) % slots.length]
}

export function pickInstance<T>(instances: readonly T[], contextKey: string, rngSeed: number): T | undefined {
  if (instances.length === 0) return undefined
  return instances[seedFrom(`${rngSeed}:instance:${contextKey}`) % instances.length]
}

/** Instances usable for this action: unrestricted ones plus those that name it. */
export function eligibleInstances<T extends { readonly for_actions?: readonly string[] }>(
  instances: readonly T[],
  actionId: string,
): T[] {
  return instances.filter((i) => !i.for_actions || i.for_actions.includes(actionId))
}
