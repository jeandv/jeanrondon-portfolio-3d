import { CD_STOPPED, sameCursor, type CdState } from '../../three/objects/cd/player'
import { composeTrack, type Song } from './compose'
import { BROWSER_INTERVALS, LookaheadScheduler, type IntervalTimers } from './scheduler'
import { stepSeconds, TRACKS, trackSeconds, type TrackSpec } from './tracks'
import { stepsInWindow, type StepTick } from './transport'
import { MusicVoices } from './voices'

/**
 * The CD's music (0 KB of files): follows the CD player's state, booking the
 * generated tracks' notes ahead of the audio clock with a look-ahead
 * scheduler. Playing → the scheduler wakes every ~25 ms; paused / stopped →
 * no timer, booked notes fade out at once. Muted, the scheduler keeps the
 * disc's place but books nothing (no voices, no CPU for silence).
 */

export interface MusicEngineOptions {
  readonly ctx: BaseAudioContext
  /** The master gain (dry). */
  readonly out: AudioNode
  /** Reverb input (small wet send), or null. */
  readonly send: AudioNode | null
  readonly noise: AudioBuffer
  readonly random?: () => number
  readonly timers?: IntervalTimers
  readonly tracks?: readonly TrackSpec[]
}

export class MusicEngine {
  private readonly ctx: BaseAudioContext
  private readonly tracks: readonly TrackSpec[]
  private readonly lengths: readonly number[]
  private readonly songs = new Map<number, Song>()
  private readonly voices: MusicVoices
  private readonly scheduler: LookaheadScheduler
  private readonly ticks: StepTick[] = []
  private state: CdState = CD_STOPPED
  private muted = false

  constructor({ ctx, out, send, noise, random = Math.random, timers = BROWSER_INTERVALS, tracks = TRACKS }: MusicEngineOptions) {
    this.ctx = ctx
    this.tracks = tracks
    this.lengths = tracks.map(trackSeconds)
    this.voices = new MusicVoices({ ctx, out, send, noise, random })
    this.scheduler = new LookaheadScheduler({
      now: () => this.ctx.currentTime,
      timers,
      onWindow: (from, to) => this.book(from, to),
    })
  }

  /** True while the scheduler is waking up (playing). */
  get scheduling(): boolean {
    return this.scheduler.running
  }

  /** Voices sounding or booked. */
  get activeVoices(): number {
    return this.voices.active
  }

  /** Follows the CD player: play, pause, stop, a new track (a settled state of the same cursor changes nothing). */
  sync(state: CdState): void {
    const now = this.ctx.currentTime
    const previous = this.state
    this.state = state
    if (state.status !== 'playing') {
      if (this.scheduler.running || previous.status === 'playing') {
        this.scheduler.stop()
        this.voices.release(now)
        this.voices.setHiss(false, now)
      }
      return
    }
    if (this.scheduler.running && sameCursor(previous, state, this.lengths, now)) return
    this.voices.release(now)
    this.voices.setHiss(!this.muted, now)
    this.scheduler.start(now)
  }

  /** Music volume as a bus gain (0…1, see audio/volume.ts). */
  setVolume(gain: number): void {
    this.voices.setLevel(gain)
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return
    this.muted = muted
    const now = this.ctx.currentTime
    if (muted) this.voices.release(now)
    this.voices.setHiss(!muted && this.state.status === 'playing', now)
  }

  /** Books the notes of every step with a grid time in [from, to) (the scheduler's window). */
  book(from: number, to: number): void {
    this.ticks.length = 0
    stepsInWindow(this.state, this.tracks, from, to, this.ticks)
    if (this.muted) return
    for (const tick of this.ticks) {
      const song = this.song(tick.track)
      const events = song?.steps[tick.step]
      if (!song || !events) continue
      const step = stepSeconds(song.spec)
      for (const event of events) this.voices.play(event, tick.time, step)
    }
  }

  dispose(): void {
    this.scheduler.stop()
    this.voices.dispose()
  }

  private song(track: number): Song | undefined {
    let song = this.songs.get(track)
    const spec = this.tracks[track]
    if (!song && spec) {
      song = composeTrack(spec)
      this.songs.set(track, song)
    }
    return song
  }
}
