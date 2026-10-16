import { audio } from '../audio/engine'
import { sfx } from '../audio/sfx'
import { useStore } from '../state/store'
import { transition, type BootEvent } from './machine'
import { gateReady, progressTarget, stepDisplayed } from './progress'
import { hasEnteredThisSession, rememberEntered, saveMuted } from './session'
import { bootSignals } from './signals'

/** Canvas fade over the still on entering (CSS uses the same values, styles/loader.css). */
export const ENTER_FADE_MS = 1200
export const ENTER_FADE_REDUCED_MS = 200

/** Longest frame step the progress lerp integrates (a shader compile can stall a frame). */
const MAX_STEP_S = 0.1

export function dispatchBoot(event: BootEvent): void {
  const state = useStore.getState()
  const next = transition(state.phase, event)
  if (next !== state.phase) state.setPhase(next)
}

export interface EnterOptions {
  /** Enter with sound (false = ENTER MUTED). */
  readonly sound: boolean
  /** Returning visitor auto-entering: no gesture, so audio unlocks on the next one. */
  readonly auto?: boolean
}

let enteredTimer = 0

/**
 * gate → entering → live. A real click creates/unlocks the AudioContext
 * (muted entry keeps the master at 0) and plays the CRT power-on. The phase
 * turns live once the canvas has faded in over the still.
 */
export function enterRoom({ sound, auto = false }: EnterOptions): void {
  const state = useStore.getState()
  if (state.phase !== 'gate') return
  // Mute first: the context is then created at the right level (no ramp-in).
  // Persist explicitly: muted is already the default, so the store may not change.
  audio.setMuted(!sound)
  state.setMuted(!sound)
  saveMuted(!sound)
  if (auto) {
    audio.unlockOnGesture()
  } else {
    audio.unlock()
    sfx('power')
  }
  rememberEntered()
  dispatchBoot('enter')
  window.clearTimeout(enteredTimer)
  enteredTimer = window.setTimeout(
    () => dispatchBoot('entered'),
    useStore.getState().reducedMotion ? ENTER_FADE_REDUCED_MS : ENTER_FADE_MS,
  )
}

export interface BootOptions {
  /** Still capture: no gate, straight to live once the scene is ready. */
  readonly capture?: boolean
  /** Returning visitor (sessionStorage): skip the gate. */
  readonly autoEnter?: boolean
}

/**
 * Drives the displayed progress every animation frame while loading
 * (lerped toward the gate-aware target, never backwards). At 100% it opens
 * the gate, auto-enters, or goes live (capture). Returns a stop function.
 */
export function startBoot({ capture = false, autoEnter = hasEnteredThisSession() }: BootOptions = {}): () => void {
  let frame = 0
  let last = performance.now()

  const onReady = () => {
    if (capture) {
      dispatchBoot('skip')
      return
    }
    dispatchBoot('ready')
    if (autoEnter) enterRoom({ sound: !useStore.getState().muted, auto: true })
  }

  const tick = (now: number) => {
    const dt = Math.min(Math.max(0, now - last) / 1000, MAX_STEP_S)
    last = now
    const state = useStore.getState()
    if (state.phase !== 'loading') return
    const signals = bootSignals.getState()
    const next = capture ? (gateReady(signals) ? 1 : 0) : stepDisplayed(state.progress, progressTarget(signals), dt)
    state.setProgress(next)
    if (useStore.getState().progress >= 1) {
      onReady()
      return
    }
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}
