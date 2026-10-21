import type { NoteEvent, VoiceId } from './compose'
import { midiToFrequency } from './theory'

/**
 * The lo-fi band (Web Audio): an FM electric piano and a soft vibraphone-ish
 * lead (both with a slow tape "wow" on their pitch), a triangle bass, a synth
 * kick, a noise snare with a short envelope, noise hats and a very low disc
 * hiss. Each note is a couple of nodes that disconnect when they end; the
 * filters, the wow LFO and the buses are shared:
 *
 *   keys (LP 2.6k) ┐
 *   lead (LP 3.8k) ├→ tone (LP 7k) → output (level) → master
 *   bass (LP 600)  │                         └→ send → reverb
 *   drums          ┘    hiss → output
 */

/**
 * Music bus level: ~0.05 RMS / 0.45 peak before the master (measured offline),
 * a few dB over the rain once it ducks; the master compressor tames the kicks.
 */
export const MUSIC_LEVEL = 0.6
/** Wet send of the music into the room reverb. */
export const MUSIC_REVERB_SEND = 0.14
/** Disc hiss: barely there. */
export const HISS_LEVEL = 0.0035
/** Peak gain per voice at velocity 1. */
export const VOICE_PEAK: Readonly<Record<VoiceId, number>> = {
  keys: 0.075,
  lead: 0.06,
  bass: 0.26,
  kick: 0.55,
  snare: 0.13,
  hat: 0.045,
  openhat: 0.04,
}
/** Pitch wobble of the keys and the lead (cents) and its rate (Hz). */
export const WOW = { cents: 7, hz: 0.45 } as const

const SILENT = 0.0001

export interface VoicesOptions {
  readonly ctx: BaseAudioContext
  /** Dry destination (the master). */
  readonly out: AudioNode
  /** Reverb input (null: dry only). */
  readonly send: AudioNode | null
  /** Shared noise loop (snare, hats, hiss). */
  readonly noise: AudioBuffer
  readonly random: () => number
}

interface Sounding {
  readonly sources: readonly AudioScheduledSourceNode[]
  readonly amp: GainNode
  readonly nodes: readonly AudioNode[]
  readonly detuned: readonly OscillatorNode[]
  /** When its sources stop (s). */
  end: number
}

/** Voices this long past their end are swept even if `ended` never fired (a source stopped before it started). */
const SWEEP_GRACE = 1

export class MusicVoices {
  private readonly ctx: BaseAudioContext
  private readonly noise: AudioBuffer
  private readonly random: () => number
  readonly output: GainNode
  private readonly tone: BiquadFilterNode
  private readonly keys: BiquadFilterNode
  private readonly lead: BiquadFilterNode
  private readonly bass: BiquadFilterNode
  private readonly drums: GainNode
  private readonly sendGain: GainNode | null
  private readonly wow: OscillatorNode
  private readonly wowDepth: GainNode
  private readonly sounding = new Set<Sounding>()
  private hiss: { readonly source: AudioBufferSourceNode; readonly gain: GainNode } | null = null

  constructor({ ctx, out, send, noise, random }: VoicesOptions) {
    this.ctx = ctx
    this.noise = noise
    this.random = random
    this.output = ctx.createGain()
    this.output.gain.value = MUSIC_LEVEL
    this.output.connect(out)
    this.sendGain = send ? ctx.createGain() : null
    if (send && this.sendGain) {
      this.sendGain.gain.value = MUSIC_REVERB_SEND
      this.output.connect(this.sendGain)
      this.sendGain.connect(send)
    }
    this.tone = this.filter('lowpass', 7000, 0.5)
    this.tone.connect(this.output)
    this.keys = this.filter('lowpass', 2600, 0.4)
    this.lead = this.filter('lowpass', 3800, 0.5)
    this.bass = this.filter('lowpass', 600, 0.6)
    this.drums = ctx.createGain()
    for (const bus of [this.keys, this.lead, this.bass, this.drums]) bus.connect(this.tone)
    this.wow = ctx.createOscillator()
    this.wow.frequency.value = WOW.hz
    this.wowDepth = ctx.createGain()
    this.wowDepth.gain.value = WOW.cents
    this.wow.connect(this.wowDepth)
    this.wow.start()
  }

  /** The music volume (a gain on the bus, 0…1 of MUSIC_LEVEL), eased so a step never clicks. */
  setLevel(gain: number, time = this.ctx.currentTime): void {
    const level = MUSIC_LEVEL * Math.min(1, Math.max(0, gain))
    this.output.gain.cancelScheduledValues(time)
    this.output.gain.setTargetAtTime(level, time, 0.04)
  }

  /** Voices still sounding (or booked). */
  get active(): number {
    return this.sounding.size
  }

  /** Plays one event at `time` (s); `step` is one 16th (s). */
  play(event: NoteEvent, time: number, step: number): void {
    this.sweep()
    const t = Math.max(time + event.nudge, this.ctx.currentTime)
    const peak = VOICE_PEAK[event.voice] * Math.min(1, Math.max(0, event.velocity))
    if (peak <= 0) return
    switch (event.voice) {
      case 'keys':
        this.fm(this.keys, event.midi, t, event.length * step, peak, { ratio: 1, index: 1.6, settle: 0.25, sustain: 0.35, decay: 0.38 })
        return
      case 'lead':
        this.fm(this.lead, event.midi, t, event.length * step, peak, { ratio: 4, index: 0.9, settle: 0.05, sustain: 0.22, decay: 0.3 })
        return
      case 'bass':
        this.bassNote(event.midi, t, event.length * step, peak)
        return
      case 'kick':
        this.kick(t, peak)
        return
      case 'snare':
        this.snare(t, peak)
        return
      case 'hat':
        this.hat(t, peak, 0.04)
        return
      case 'openhat':
        this.hat(t, peak, 0.26)
    }
  }

  /** Fades the disc hiss in (playing) or out. */
  setHiss(on: boolean, time = this.ctx.currentTime): void {
    if (on && !this.hiss) {
      const source = this.noiseSource(true)
      const high = this.filter('highpass', 3200, 0.5)
      const gain = this.ctx.createGain()
      gain.gain.setValueAtTime(0, time)
      gain.gain.linearRampToValueAtTime(HISS_LEVEL, time + 0.4)
      source.connect(high)
      high.connect(gain)
      gain.connect(this.output)
      source.start(time, this.random() * this.noise.duration)
      source.onended = () => {
        source.disconnect()
        high.disconnect()
        gain.disconnect()
      }
      this.hiss = { source, gain }
    } else if (!on && this.hiss) {
      const { source, gain } = this.hiss
      gain.gain.cancelScheduledValues(time)
      gain.gain.setTargetAtTime(0, time, 0.08)
      source.stop(time + 0.5)
      this.hiss = null
    }
  }

  /** Quickly fades and stops everything sounding or booked (pause, a new track, mute). */
  release(time = this.ctx.currentTime): void {
    for (const voice of this.sounding) {
      voice.amp.gain.cancelScheduledValues(time)
      voice.amp.gain.setTargetAtTime(0, time, 0.02)
      voice.end = Math.min(voice.end, time + 0.12)
      for (const source of voice.sources) {
        try {
          source.stop(voice.end)
        } catch {
          // Already stopped.
        }
      }
    }
  }

  dispose(): void {
    this.release()
    this.setHiss(false)
    this.wow.stop()
    this.wow.disconnect()
    this.output.disconnect()
    this.sendGain?.disconnect()
  }

  private filter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter()
    node.type = type
    node.frequency.value = frequency
    node.Q.value = q
    return node
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = this.noise
    source.loop = loop
    return source
  }

  /** Registers a voice; its nodes disconnect once the first source ends. */
  private track(sources: AudioScheduledSourceNode[], amp: GainNode, nodes: readonly AudioNode[], end: number, detuned: readonly OscillatorNode[] = []): void {
    const voice: Sounding = { sources, amp, nodes, detuned, end }
    this.sounding.add(voice)
    for (const source of sources) source.stop(end)
    const first = sources[0]
    if (first) first.onended = () => this.finish(voice)
  }

  private finish(voice: Sounding): void {
    if (!this.sounding.delete(voice)) return
    for (const osc of voice.detuned) {
      try {
        this.wowDepth.disconnect(osc.detune)
      } catch {
        // Not connected any more.
      }
    }
    for (const node of voice.nodes) node.disconnect()
  }

  /** Frees voices long past their end whose `ended` never came. */
  private sweep(): void {
    const late = this.ctx.currentTime - SWEEP_GRACE
    for (const voice of this.sounding) if (voice.end < late) this.finish(voice)
  }

  /**
   * Two-operator FM: a sine carrier phase-modulated by a sine at `ratio`×,
   * the index falling from `index` to `settle` (a bright tine that mellows).
   */
  private fm(
    bus: AudioNode,
    midi: number,
    t: number,
    hold: number,
    peak: number,
    shape: { ratio: number; index: number; settle: number; sustain: number; decay: number },
  ): void {
    const f = midiToFrequency(midi)
    const carrier = this.ctx.createOscillator()
    carrier.frequency.value = f
    const modulator = this.ctx.createOscillator()
    modulator.frequency.value = f * shape.ratio
    const depth = this.ctx.createGain()
    depth.gain.setValueAtTime(f * shape.index, t)
    depth.gain.exponentialRampToValueAtTime(Math.max(f * shape.settle, 1), t + 0.5)
    modulator.connect(depth)
    depth.connect(carrier.frequency)
    this.wowDepth.connect(carrier.detune)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(peak, t + 0.006)
    amp.gain.setTargetAtTime(peak * shape.sustain, t + 0.006, shape.decay)
    const release = t + Math.max(hold, 0.08)
    amp.gain.setTargetAtTime(0, release, 0.09)
    carrier.connect(amp)
    amp.connect(bus)
    carrier.start(t)
    modulator.start(t)
    this.track([carrier, modulator], amp, [carrier, modulator, depth, amp], release + 0.6, [carrier])
  }

  private bassNote(midi: number, t: number, hold: number, peak: number): void {
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = midiToFrequency(midi)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(peak, t + 0.012)
    amp.gain.setTargetAtTime(peak * 0.7, t + 0.012, 0.25)
    const release = t + Math.max(hold - 0.02, 0.06)
    amp.gain.setTargetAtTime(0, release, 0.05)
    osc.connect(amp)
    amp.connect(this.bass)
    osc.start(t)
    this.track([osc], amp, [osc, amp], release + 0.35)
  }

  private kick(t: number, peak: number): void {
    const osc = this.ctx.createOscillator()
    osc.frequency.setValueAtTime(130, t)
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.11)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(SILENT, t)
    amp.gain.exponentialRampToValueAtTime(peak, t + 0.004)
    amp.gain.exponentialRampToValueAtTime(SILENT, t + 0.38)
    osc.connect(amp)
    amp.connect(this.drums)
    osc.start(t)
    this.track([osc], amp, [osc, amp], t + 0.4)
  }

  private snare(t: number, peak: number): void {
    const noise = this.noiseSource()
    const band = this.filter('bandpass', 1800, 0.9)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(SILENT, t)
    amp.gain.exponentialRampToValueAtTime(peak, t + 0.002)
    amp.gain.exponentialRampToValueAtTime(SILENT, t + 0.17)
    noise.connect(band)
    band.connect(amp)
    const body = this.ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.value = 185
    const bodyAmp = this.ctx.createGain()
    bodyAmp.gain.setValueAtTime(SILENT, t)
    bodyAmp.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.002)
    bodyAmp.gain.exponentialRampToValueAtTime(SILENT, t + 0.07)
    body.connect(bodyAmp)
    bodyAmp.connect(amp)
    amp.connect(this.drums)
    noise.start(t, this.random() * Math.max(0, this.noise.duration - 0.3))
    body.start(t)
    this.track([noise, body], amp, [noise, band, body, bodyAmp, amp], t + 0.2)
  }

  private hat(t: number, peak: number, decay: number): void {
    const noise = this.noiseSource()
    const high = this.filter('highpass', 7200, 0.7)
    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(SILENT, t)
    amp.gain.exponentialRampToValueAtTime(peak, t + 0.001)
    amp.gain.exponentialRampToValueAtTime(SILENT, t + decay)
    noise.connect(high)
    high.connect(amp)
    amp.connect(this.drums)
    noise.start(t, this.random() * Math.max(0, this.noise.duration - 0.4))
    this.track([noise], amp, [noise, high, amp], t + decay + 0.02)
  }
}
