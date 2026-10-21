import type { DialPlan } from './modem'

/**
 * Sound event bus: interaction code (three objects, DOM UI) calls `sfx('tick')`
 * and never touches Web Audio. The audio engine registers itself as the
 * listener once the app starts (src/audio/wiring.ts).
 */
export type SoundId =
  | 'tick'
  | 'click'
  | 'tape'
  | 'eject'
  | 'lamp'
  | 'power'
  | 'key'
  | 'static'
  | 'sip'
  | 'clink'
  | 'clock'
  | 'card'
  | 'lid'
  | 'calc'

type Listener = (id: SoundId) => void

let listener: Listener | null = null

export function sfx(id: SoundId): void {
  listener?.(id)
}

/** Sets the listener; the returned function removes it (if still current). */
export function setSfxListener(next: Listener | null): () => void {
  listener = next
  return () => {
    if (listener === next) listener = null
  }
}

/* ------------------------------------------------------------------ */
/* Sequences: longer sounds the caller can cut short                    */
/* ------------------------------------------------------------------ */

/** Stops a running sequence (idempotent). */
export type StopSound = () => void

type ModemStarter = (plan: DialPlan) => StopSound

const silent: StopSound = () => undefined
let modemStarter: ModemStarter | null = null

/** The BBS dial-up (DTMF, ringback, handshake); returns its stop. Silent when locked or muted. */
export function startModemSound(plan: DialPlan): StopSound {
  return modemStarter?.(plan) ?? silent
}

export function setModemListener(next: ModemStarter | null): () => void {
  modemStarter = next
  return () => {
    if (modemStarter === next) modemStarter = null
  }
}
