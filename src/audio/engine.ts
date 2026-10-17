import { CD_STOPPED, type CdState } from '../three/objects/cd/player'
import { startModem, type DialPlan } from './modem'
import { MusicEngine } from './music/engine'
import { BROWSER_INTERVALS, type IntervalTimers } from './music/scheduler'
import { createReverb, REVERB_SEND } from './reverb'
import type { SoundId, StopSound } from './sfx'
import { createNoiseBuffer, NOISE_SECONDS, SOUNDS, startRain, type Ambience, type Timers } from './synth'

/**
 * Web Audio engine (plan §5.9): master Gain → DynamicsCompressor → destination,
 * plus a convolution reverb returning into the master (reverb.ts): one-shots
 * play into a bus per send level (dry to the master, a wet send to the
 * convolver); the rain goes to the master dry. The CD's music (music/engine.ts)
 * plays into the master with a small wet send and ducks the rain a little.
 * The AudioContext is only created inside a user gesture (`unlock()`); before
 * that every call just records state. Muting ramps the master with
 * setTargetAtTime (the music books no notes meanwhile); a hidden tab suspends
 * the context (and so the music's clock).
 */

/** How much the rain dips while the CD plays. */
export const RAIN_DUCK = 0.35

export const MASTER_LEVEL = 0.8
/** setTargetAtTime time constant (s) of the mute ramp. */
export const MUTE_TIME_CONSTANT = 0.12

export const COMPRESSOR = { threshold: -16, ratio: 2.5, knee: 12, attack: 0.003, release: 0.25 } as const

/** Minimum gap (ms) between two plays of the same sound. */
export const MIN_INTERVAL_MS: Readonly<Partial<Record<SoundId, number>>> = { tick: 60, key: 35, static: 120, clock: 400 }

const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const

export interface AudioEngineOptions {
  /** Context factory (tests inject a mock). Called at most once, from `unlock()`. */
  readonly createContext?: () => AudioContext | null
  /** Clock (ms) for the per-sound throttle. */
  readonly now?: () => number
  readonly random?: () => number
  readonly timers?: Timers
  /** Interval timers of the music's look-ahead scheduler. */
  readonly intervals?: IntervalTimers
}

function browserContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  try {
    return new window.AudioContext({ latencyHint: 'interactive' })
  } catch {
    return null
  }
}

const BROWSER_TIMERS: Timers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (id) => window.clearTimeout(id),
}

const ignore = () => undefined

export class AudioEngine {
  private readonly createContext: () => AudioContext | null
  private readonly now: () => number
  private readonly random: () => number
  private readonly timers: Timers
  private readonly intervals: IntervalTimers
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private reverb: ConvolverNode | null = null
  /** One bus per wet-send level: dry → master, send → reverb. */
  private readonly buses = new Map<number, GainNode>()
  private noise: AudioBuffer | null = null
  private rain: Ambience | null = null
  /** Created on the first play of the CD. */
  private music: MusicEngine | null = null
  private cd: CdState = CD_STOPPED
  private muted = true
  private hidden = false
  private readonly lastPlayed = new Map<SoundId, number>()
  private disarmGesture: (() => void) | null = null

  constructor(options: AudioEngineOptions = {}) {
    this.createContext = options.createContext ?? browserContext
    this.now = options.now ?? (() => performance.now())
    this.random = options.random ?? Math.random
    this.timers = options.timers ?? BROWSER_TIMERS
    this.intervals = options.intervals ?? BROWSER_INTERVALS
  }

  /** The clock the CD player runs on (s): the AudioContext's once it exists. */
  musicNow(): number {
    return this.ctx ? this.ctx.currentTime : this.now() / 1000
  }

  /** Follows the CD player (play / pause / track); nothing before unlock. */
  syncMusic(cd: CdState): void {
    this.cd = cd
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise) return
    if (!this.music) {
      if (cd.status !== 'playing') return
      this.music = new MusicEngine({ ctx, out: master, send: this.reverb, noise, random: this.random, timers: this.intervals })
      this.music.setMuted(this.muted)
    }
    this.music.sync(cd)
    this.rain?.duck(cd.status === 'playing' ? RAIN_DUCK : 0)
  }

  /** True while the music's scheduler is running. */
  get musicPlaying(): boolean {
    return this.music?.scheduling ?? false
  }

  /** True once the AudioContext exists. */
  get unlocked(): boolean {
    return this.ctx !== null
  }

  get isMuted(): boolean {
    return this.muted
  }

  /**
   * Creates the context on the first call (with the master already at the
   * recorded mute level, so entering with sound does not ramp in) and
   * resumes it afterwards. Call it from a click / key handler.
   */
  unlock(): void {
    this.disarmGesture?.()
    let ctx = this.ctx
    if (!ctx) {
      ctx = this.createContext()
      if (!ctx) return
      this.ctx = ctx
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = COMPRESSOR.threshold
      compressor.ratio.value = COMPRESSOR.ratio
      compressor.knee.value = COMPRESSOR.knee
      compressor.attack.value = COMPRESSOR.attack
      compressor.release.value = COMPRESSOR.release
      compressor.connect(ctx.destination)
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : MASTER_LEVEL
      master.connect(compressor)
      this.master = master
      this.noise = createNoiseBuffer(ctx, NOISE_SECONDS, this.random)
      try {
        const reverb = createReverb(ctx, this.random)
        reverb.connect(master)
        this.reverb = reverb
      } catch {
        // No convolver: everything plays dry.
        this.reverb = null
      }
    }
    if (!this.hidden && ctx.state === 'suspended') void ctx.resume().catch(ignore)
    this.syncRain()
    if (this.cd.status === 'playing') this.syncMusic(this.cd)
  }

  /**
   * For visitors who skipped the gate: unlock on their first pointer or key
   * gesture anywhere (an AudioContext cannot start without one).
   */
  unlockOnGesture(target: EventTarget = window): void {
    if (this.ctx || this.disarmGesture) return
    const onGesture = () => this.unlock()
    for (const type of GESTURE_EVENTS) target.addEventListener(type, onGesture, { capture: true, passive: true })
    this.disarmGesture = () => {
      for (const type of GESTURE_EVENTS) target.removeEventListener(type, onGesture, { capture: true })
      this.disarmGesture = null
    }
  }

  /** Ramps the master to 0 / MASTER_LEVEL (recorded only before unlock). */
  setMuted(muted: boolean): void {
    this.muted = muted
    const { ctx, master } = this
    if (!ctx || !master) return
    const t = ctx.currentTime
    master.gain.cancelScheduledValues(t)
    master.gain.setValueAtTime(master.gain.value, t)
    master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, t, MUTE_TIME_CONSTANT)
    this.music?.setMuted(muted)
    this.syncRain()
  }

  /** Hidden tab: suspend the context; visible again: resume it. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    const ctx = this.ctx
    if (!ctx) return
    if (hidden) void ctx.suspend().catch(ignore)
    else void ctx.resume().catch(ignore)
  }

  /** Plays a one-shot; false when locked, muted, hidden or throttled. */
  play(id: SoundId): boolean {
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise || this.muted || this.hidden) return false
    const now = this.now()
    const last = this.lastPlayed.get(id)
    if (last !== undefined && now - last < (MIN_INTERVAL_MS[id] ?? 0)) return false
    this.lastPlayed.set(id, now)
    SOUNDS[id]({ ctx, out: this.busFor(REVERB_SEND[id]), noise, random: this.random })
    return true
  }

  /** Starts the BBS dial-up; a no-op stop when locked, muted or hidden. */
  startModem(plan: DialPlan): StopSound {
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise || this.muted || this.hidden) return () => undefined
    return startModem({ ctx, out: this.busFor(REVERB_SEND.modem), noise, random: this.random }, plan)
  }

  /** The output for a sound with wet send `level`: dry into the master, `level` into the reverb. */
  private busFor(level: number): AudioNode {
    const { ctx, master, reverb } = this
    if (!ctx || !master) throw new Error('[audio] busFor before unlock')
    if (!reverb || level <= 0) return master
    let bus = this.buses.get(level)
    if (!bus) {
      bus = ctx.createGain()
      const send = ctx.createGain()
      send.gain.value = level
      bus.connect(master)
      bus.connect(send)
      send.connect(reverb)
      this.buses.set(level, bus)
    }
    return bus
  }

  /** The rain starts the first time sound is on (dry: straight into the master); muted, it idles at gain 0 without drops. */
  private syncRain(): void {
    const { ctx, master, noise } = this
    if (!ctx || !master || !noise || this.rain || this.muted) return
    this.rain = startRain({ ctx, out: master, noise, random: this.random }, this.timers, () => this.canDrop())
    if (this.cd.status === 'playing') this.rain.duck(RAIN_DUCK)
  }

  private canDrop(): boolean {
    return this.ctx?.state === 'running' && !this.muted && !this.hidden
  }
}

/** The app's engine. */
export const audio = new AudioEngine()
