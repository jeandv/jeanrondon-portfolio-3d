import { cursorAt, type CdAction, type CdState } from '../../three/objects/cd/player'
import type { DiscInfo } from './discs'
import type { MusicSource, SourceAction, SourceClock, SourceSnapshot } from './source'

/**
 * Disc 1, the generated lo-fi, as a MusicSource: a thin view over the CD
 * player's pure state (src/three/objects/cd/player.ts, held by the store) on
 * the music clock; the music engine follows that state on its own
 * (src/audio/wiring.ts). Volume goes to the music bus; SOUND OFF and the
 * hidden tab are already handled by the audio engine (master ramp, suspended
 * context).
 */

export interface GenerativeHooks {
  readonly state: () => CdState
  readonly act: (action: CdAction) => void
  readonly playTrack: (index: number) => void
  /** The music clock (s). */
  readonly now: () => number
  readonly lengths: readonly number[]
  readonly setVolume: (volume: number) => void
}

export class GenerativeSource implements MusicSource {
  readonly disc: DiscInfo
  private readonly hooks: GenerativeHooks

  constructor(disc: DiscInfo, hooks: GenerativeHooks) {
    this.disc = disc
    this.hooks = hooks
  }

  snapshot(): SourceSnapshot {
    const state = this.hooks.state()
    return { status: state.status, track: cursorAt(state, this.hooks.lengths, this.hooks.now()).track, error: false }
  }

  clock(): SourceClock {
    const cursor = cursorAt(this.hooks.state(), this.hooks.lengths, this.hooks.now())
    return { elapsed: Math.max(0, cursor.position), duration: this.hooks.lengths[cursor.track] ?? null }
  }

  press(action: SourceAction): void {
    this.hooks.act(action)
  }

  playTrack(index: number): void {
    this.hooks.playTrack(index)
  }

  setVolume(volume: number): void {
    this.hooks.setVolume(volume)
  }

  setMuted(): void {
    // The master ramp (audio/engine.ts) silences it; the disc keeps its place.
  }

  setHidden(): void {
    // A hidden tab suspends the AudioContext: the music clock (and so the disc) stops with it.
  }
}
