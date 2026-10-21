import type { DiscInfo } from './discs'

/**
 * What the CD player plays from, whatever the disc: the generated lo-fi
 * (generativeSource.ts) or the YouTube playlist (src/audio/youtube). The LCD,
 * its buttons and the keys only talk to this interface (deck.ts picks the
 * source of the disc in the player).
 */

export type SourceStatus = 'stopped' | 'loading' | 'playing' | 'paused'

/** Transport buttons; `stop` is the eject (YouTube: the player goes away). */
export type SourceAction = 'toggle' | 'play' | 'pause' | 'stop' | 'next' | 'prev'

export interface SourceClock {
  /** Seconds into the current track. */
  readonly elapsed: number
  /** Track length (s), null while unknown (a video not loaded yet). */
  readonly duration: number | null
}

/** Discrete state worth a re-render (the store mirrors it; the clock is read per frame instead). */
export interface SourceSnapshot {
  readonly status: SourceStatus
  /** 0-based. */
  readonly track: number
  /** The LCD reads ERR (a video that cannot play; it skips on). */
  readonly error: boolean
}

export const STOPPED_SNAPSHOT: SourceSnapshot = { status: 'stopped', track: 0, error: false }

export interface MusicSource {
  readonly disc: DiscInfo
  snapshot(): SourceSnapshot
  clock(): SourceClock
  press(action: SourceAction): void
  /** Plays track `index` (0-based) from the start. */
  playTrack(index: number): void
  /** 0–100. */
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  /** Hidden tab: pause, and resume on return if it was playing. */
  setHidden(hidden: boolean): void
}

/** `prev` within this many seconds of a track's start goes to the previous track, later it restarts it. */
export const PREV_RESTART_SECONDS = 3
