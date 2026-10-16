import type { Phase } from '../state/store'

/**
 * Boot state machine (plan §5.1): loading → gate → entering → live, or
 * fallback from anywhere (no WebGL2, a crash, a lost context).
 *   ready   — progress hit 100% (every gate condition holds)
 *   enter   — the visitor clicked through the gate (or auto-enter)
 *   entered — the canvas fade finished
 *   skip    — straight to live, no gate (still capture)
 *   fail    — fallback
 * Events that do not apply to the current phase leave it unchanged.
 */
export type BootEvent = 'ready' | 'enter' | 'entered' | 'skip' | 'fail'

export function transition(phase: Phase, event: BootEvent): Phase {
  if (phase === 'fallback') return phase
  switch (event) {
    case 'fail':
      return 'fallback'
    case 'ready':
      return phase === 'loading' ? 'gate' : phase
    case 'enter':
      return phase === 'gate' ? 'entering' : phase
    case 'entered':
      return phase === 'entering' ? 'live' : phase
    case 'skip':
      return phase === 'loading' || phase === 'gate' ? 'live' : phase
  }
}

/** Before the gate is passed: the camera waits on the home frame and nothing reacts. */
export function isBootPhase(phase: Phase): boolean {
  return phase === 'loading' || phase === 'gate'
}

/** Hotspots, shortcuts, screen hits and OrbitControls only respond while live. */
export function isInteractivePhase(phase: Phase): boolean {
  return phase === 'live'
}
