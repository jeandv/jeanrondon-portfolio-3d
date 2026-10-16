/**
 * Loader progress (plan §5.1). Network bytes fill the bar up to 80%; the
 * remaining 20% is the work that happens once the assets are in: screen
 * fonts, shader compile (<Preload all/>) and the first rendered frames.
 * The target only reaches 1 when every gate condition holds, and the
 * displayed value is lerped toward it and never goes back.
 */

/** Share of the bar driven by network bytes. */
export const NETWORK_SHARE = 0.8

/** Shares of the post-network steps (they add up to 1 − NETWORK_SHARE). */
export const STEP_SHARE = { fonts: 0.06, compiled: 0.09, frames: 0.05 } as const

/** Frames that must have rendered (after compiling) before the gate. */
export const GATE_FRAMES = 2

/** Highest target while any gate condition is still missing. */
export const MAX_BEFORE_GATE = 0.99

/** Byte estimates can be off: the network share is only full once the assets are actually in. */
const NETWORK_CAP = 0.98

/** Lerp rate (1/s) of the displayed value toward the target. */
export const DISPLAY_RATE = 3.2

/** Below this gap the displayed value lands on the target. */
const SNAP = 0.002

export interface BootSignals {
  /** Network bytes loaded / expected, 0..1. */
  readonly network: number
  /** The GLB and textures are loaded (the scene mounted). */
  readonly assets: boolean
  /** The screen fonts promise (screens/fonts.ts) settled. */
  readonly fonts: boolean
  /** <Preload all/> compiled the scene. */
  readonly compiled: boolean
  /** Frames rendered since the compile. */
  readonly frames: number
}

export const INITIAL_SIGNALS: BootSignals = { network: 0, assets: false, fonts: false, compiled: false, frames: 0 }

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/** All four gate conditions (plan §5.1). */
export function gateReady(signals: BootSignals): boolean {
  return signals.assets && signals.fonts && signals.compiled && signals.frames >= GATE_FRAMES
}

/**
 * Where the bar should be: 80% × network fraction, then fonts / compile /
 * frames on top once the assets are in. 1 only when the gate is ready.
 */
export function progressTarget(signals: BootSignals): number {
  if (gateReady(signals)) return 1
  if (!signals.assets) return Math.min(clamp01(signals.network), NETWORK_CAP) * NETWORK_SHARE
  let target = NETWORK_SHARE
  if (signals.fonts) target += STEP_SHARE.fonts
  if (signals.compiled) target += STEP_SHARE.compiled
  target += (STEP_SHARE.frames * Math.min(signals.frames, GATE_FRAMES)) / GATE_FRAMES
  return Math.min(target, MAX_BEFORE_GATE)
}

/**
 * Moves the displayed value toward `target` (exponential lerp, `dt` in
 * seconds). It never decreases and lands exactly on the target when close.
 */
export function stepDisplayed(displayed: number, target: number, dt: number, rate = DISPLAY_RATE): number {
  const current = clamp01(displayed)
  const goal = clamp01(target)
  if (goal <= current) return current
  const next = current + (goal - current) * (1 - Math.exp(-rate * Math.max(0, dt)))
  return goal - next < SNAP ? goal : next
}

/** Whole percent shown by the OSD (100 only at exactly 1). */
export function percentOf(progress: number): number {
  return Math.floor(clamp01(progress) * 100)
}
