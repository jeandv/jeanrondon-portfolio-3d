/**
 * Adaptive quality (plan §10.4), pure part. Tiers step the DPR down within the
 * device profile's range (never above the screen's own DPR), and the last
 * tier also drops MSAA. A sustained fps drop steps down, a sustained recovery
 * steps back up; after FLIP_FLOPS direction changes the stepper settles on the
 * lower of the two settings it was bouncing between and stops.
 */

export interface QualityTier {
  readonly dpr: number
  readonly msaa: 0 | 4
}

/** What the store / `window.__renderInfo()` report. */
export interface QualityInfo {
  readonly tier: number
  readonly tiers: number
  readonly dpr: number
  readonly msaa: 0 | 4
  readonly settled: boolean
}

/** DPR ladder, best first. */
export const DPR_LADDER: readonly number[] = [2, 1.75, 1.5, 1.25, 1]
/** Direction changes allowed before settling. */
export const FLIP_FLOPS = 3
/** fps below which a window counts as slow, and at/above which it counts as smooth. */
export function fpsBounds(refreshRate: number): [lower: number, upper: number] {
  return [50, refreshRate > 100 ? 90 : 57]
}

/** Tiers for a DPR range [min, max] on a screen of `nativeDpr`. */
export function qualityTiers(range: readonly [number, number], msaa: 0 | 4, nativeDpr: number): QualityTier[] {
  const [min, max] = range
  const top = Math.max(min, Math.min(max, nativeDpr || 1))
  const ladder = [top, ...DPR_LADDER.filter((dpr) => dpr < top - 0.01 && dpr >= min - 1e-6)]
  if (!ladder.includes(min) && min < top) ladder.push(min)
  const tiers: QualityTier[] = ladder.map((dpr) => ({ dpr, msaa }))
  if (msaa > 0) tiers.push({ dpr: min, msaa: 0 })
  return tiers
}

export interface QualityState {
  readonly index: number
  readonly lastMove: 'up' | 'down' | null
  readonly flips: number
  readonly settled: boolean
}

export const INITIAL_QUALITY: QualityState = { index: 0, lastMove: null, flips: 0, settled: false }

/** One step (`down` = lower quality = higher index). Bounds and settled states don't move. */
export function stepQuality(state: QualityState, move: 'up' | 'down', tierCount: number, maxFlips = FLIP_FLOPS): QualityState {
  if (state.settled) return state
  const index = Math.min(tierCount - 1, Math.max(0, state.index + (move === 'down' ? 1 : -1)))
  if (index === state.index) return state
  const flipped = state.lastMove !== null && state.lastMove !== move
  const flips = state.flips + (flipped ? 1 : 0)
  if (flips >= maxFlips) {
    // Settle on the lower of the two settings: stay put when the flip was a step up.
    return { index: move === 'up' ? state.index : index, lastMove: move, flips, settled: true }
  }
  return { index, lastMove: move, flips, settled: false }
}

export function qualityInfo(state: QualityState, tiers: readonly QualityTier[]): QualityInfo {
  const tier = tiers[state.index] ?? tiers[0] ?? { dpr: 1, msaa: 0 }
  return { tier: state.index, tiers: tiers.length, dpr: tier.dpr, msaa: tier.msaa, settled: state.settled }
}
