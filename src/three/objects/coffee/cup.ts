/**
 * The coffee mug's state (pure, three-free: the store and the hotspot label
 * use it from the main chunk). Five sips empty the cup; an empty cup refills
 * itself after a while (or on reload). Times are epoch milliseconds.
 */

export const SIPS_PER_CUP = 5
/** An empty cup refills after this long. */
export const REFILL_MS = 75_000
/** Steam fades as the coffee cools: e-folding time of the heat. */
export const COOL_MS = 240_000
/** Lukewarm coffee still steams a little. */
export const MIN_HEAT = 0.3

/**
 * The sip motion (s): lift toward the camera, hold tilted, put back. A click
 * during it is ignored, so sips never stack.
 */
export const SIP_TIMING = { lift: 0.42, hold: 0.42, back: 0.5 } as const
export const SIP_SECONDS = SIP_TIMING.lift + SIP_TIMING.hold + SIP_TIMING.back

export interface CupState {
  /** Sips taken from this cup (0 = full, SIPS_PER_CUP = empty). */
  readonly sips: number
  /** When this cup was (re)filled. */
  readonly filledAt: number
  /** Last sip (null: none yet). */
  readonly lastSipAt: number | null
  /** When the last sip emptied it (null: not empty). */
  readonly emptiedAt: number | null
}

export function fullCup(now: number): CupState {
  return { sips: 0, filledAt: now, lastSipAt: null, emptiedAt: null }
}

export function isEmpty(cup: CupState): boolean {
  return cup.sips >= SIPS_PER_CUP
}

/** Still lifting / holding / putting back the previous sip. */
export function isSipping(cup: CupState, now: number): boolean {
  return cup.lastSipAt !== null && now - cup.lastSipAt < SIP_SECONDS * 1000
}

/** One sip; unchanged when empty or mid-sip. */
export function takeSip(cup: CupState, now: number): CupState {
  if (isEmpty(cup) || isSipping(cup, now)) return cup
  const sips = cup.sips + 1
  return { ...cup, sips, lastSipAt: now, emptiedAt: sips >= SIPS_PER_CUP ? now : null }
}

export function refillDue(cup: CupState, now: number): boolean {
  return cup.emptiedAt !== null && now - cup.emptiedAt >= REFILL_MS
}

/** A fresh cup once the refill is due; otherwise the same cup. */
export function maybeRefill(cup: CupState, now: number): CupState {
  return refillDue(cup, now) ? fullCup(now) : cup
}

/** Coffee left, 1 (full) … 0 (empty). */
export function coffeeLeft(sips: number): number {
  return Math.min(1, Math.max(0, 1 - sips / SIPS_PER_CUP))
}

/** 0..1: the coffee's heat (1 just poured, decaying to MIN_HEAT). */
export function heatOf(cup: CupState, now: number): number {
  const age = Math.max(0, now - cup.filledAt)
  return MIN_HEAT + (1 - MIN_HEAT) * Math.exp(-age / COOL_MS)
}

/** Steam strength 0..1: none when empty, less as it cools and empties. */
export function steamAmount(cup: CupState, now: number): number {
  if (isEmpty(cup)) return 0
  return heatOf(cup, now) * (0.45 + 0.55 * coffeeLeft(cup.sips))
}

export type SipPhase = 'lift' | 'hold' | 'back' | 'idle'

/** Where a sip is `elapsed` seconds after the click. */
export function sipPhase(elapsed: number): SipPhase {
  if (elapsed < 0) return 'idle'
  if (elapsed < SIP_TIMING.lift) return 'lift'
  if (elapsed < SIP_TIMING.lift + SIP_TIMING.hold) return 'hold'
  if (elapsed < SIP_SECONDS) return 'back'
  return 'idle'
}
