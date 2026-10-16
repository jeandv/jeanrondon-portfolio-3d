import type { SoundId } from './sfx'

/**
 * Procedural sounds (plan §5.9: 0 KB of audio files). Everything is built
 * from one looped noise buffer and a few oscillators per call; nodes
 * disconnect themselves when their source ends.
 */

export interface SynthContext {
  readonly ctx: BaseAudioContext
  /** Destination for this voice (the master gain, or the rain bus). */
  readonly out: AudioNode
  readonly noise: AudioBuffer
  readonly random: () => number
}

export interface Timers {
  set(callback: () => void, ms: number): number
  clear(id: number): void
}

/** Length (s) of the shared noise loop. */
export const NOISE_SECONDS = 2

/** Pinkish noise (Paul Kellet's economy filter): softer than white for the rain bed. */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds: number, random: () => number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1
    b0 = 0.99765 * b0 + white * 0.099046
    b1 = 0.963 * b1 + white * 0.2965164
    b2 = 0.57 * b2 + white * 1.0526913
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22
  }
  return buffer
}

const SILENT = 0.0001

/** Exponential attack/decay on a gain param starting at `t`. */
function envelope(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(SILENT, t)
  param.exponentialRampToValueAtTime(Math.max(peak, SILENT * 2), t + attack)
  param.exponentialRampToValueAtTime(SILENT, t + attack + decay)
}

function disconnectOnEnd(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
  source.onended = () => {
    for (const node of nodes) node.disconnect()
  }
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const node = ctx.createBiquadFilter()
  node.type = type
  node.frequency.value = frequency
  node.Q.value = q
  return node
}

export interface BurstOptions {
  /** Delay (s) from now. */
  readonly at?: number
  readonly duration: number
  readonly type: BiquadFilterType
  readonly frequency: number
  readonly q?: number
  readonly gain: number
  readonly attack?: number
  /** Stereo position −1..1. */
  readonly pan?: number
}

/** A filtered slice of the noise loop with an attack/decay envelope. */
export function noiseBurst({ ctx, out, noise, random }: SynthContext, options: BurstOptions): void {
  const attack = options.attack ?? 0.002
  const t = ctx.currentTime + (options.at ?? 0)
  const length = attack + options.duration + 0.02
  const source = ctx.createBufferSource()
  source.buffer = noise
  const band = filter(ctx, options.type, options.frequency, options.q)
  const amp = ctx.createGain()
  envelope(amp.gain, t, options.gain, attack, options.duration)
  source.connect(band)
  band.connect(amp)
  const nodes: AudioNode[] = [source, band, amp]
  if (options.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, options.pan))
    amp.connect(panner)
    panner.connect(out)
    nodes.push(panner)
  } else {
    amp.connect(out)
  }
  source.start(t, random() * Math.max(0, noise.duration - length), length)
  disconnectOnEnd(source, nodes)
}

export interface ToneOptions {
  readonly at?: number
  readonly type: OscillatorType
  readonly from: number
  /** Pitch at the end of the decay (exponential glide). */
  readonly to?: number
  readonly duration: number
  readonly gain: number
  readonly attack?: number
}

/** An oscillator blip with an optional pitch glide. */
export function tone({ ctx, out }: SynthContext, options: ToneOptions): void {
  const attack = options.attack ?? 0.003
  const t = ctx.currentTime + (options.at ?? 0)
  const osc = ctx.createOscillator()
  osc.type = options.type
  osc.frequency.setValueAtTime(options.from, t)
  if (options.to !== undefined) osc.frequency.exponentialRampToValueAtTime(options.to, t + attack + options.duration)
  const amp = ctx.createGain()
  envelope(amp.gain, t, options.gain, attack, options.duration)
  osc.connect(amp)
  amp.connect(out)
  osc.start(t)
  osc.stop(t + attack + options.duration + 0.03)
  disconnectOnEnd(osc, [osc, amp])
}

/** One-shot UI sounds. Levels sit well under the rain so nothing pokes out. */
export const SOUNDS: Readonly<Record<SoundId, (voice: SynthContext) => void>> = {
  /** Hover: a tiny high blip. */
  tick: (voice) => {
    tone(voice, { type: 'sine', from: 2300, to: 1700, duration: 0.028, gain: 0.03, attack: 0.002 })
    noiseBurst(voice, { type: 'highpass', frequency: 5200, duration: 0.012, gain: 0.018, attack: 0.001 })
  },
  /** Click: plastic switch. */
  click: (voice) => {
    tone(voice, { type: 'triangle', from: 1300, to: 650, duration: 0.05, gain: 0.05, attack: 0.002 })
    noiseBurst(voice, { type: 'bandpass', frequency: 3200, q: 1.4, duration: 0.03, gain: 0.05, attack: 0.001 })
  },
  /** Keyboard shortcut: a soft key. */
  key: (voice) => {
    noiseBurst(voice, { type: 'bandpass', frequency: 2100, q: 2.5, duration: 0.024, gain: 0.04, attack: 0.001 })
    tone(voice, { type: 'sine', from: 190, to: 120, duration: 0.04, gain: 0.03, attack: 0.002 })
  },
  /** Tape in: a low thump and the mechanism clacking shut. */
  tape: (voice) => {
    tone(voice, { type: 'sine', from: 115, to: 48, duration: 0.16, gain: 0.28, attack: 0.004 })
    noiseBurst(voice, { type: 'lowpass', frequency: 1100, duration: 0.07, gain: 0.12, attack: 0.002 })
    noiseBurst(voice, { at: 0.13, type: 'bandpass', frequency: 1800, q: 1.2, duration: 0.05, gain: 0.07, attack: 0.002 })
  },
  /** CRT power-on: degauss thump, a burst of static and a faint flyback whine. */
  power: (voice) => {
    tone(voice, { type: 'sine', from: 72, to: 34, duration: 0.38, gain: 0.32, attack: 0.006 })
    noiseBurst(voice, { type: 'bandpass', frequency: 3400, q: 0.6, duration: 0.55, gain: 0.08, attack: 0.01 })
    tone(voice, { at: 0.04, type: 'sine', from: 15700, duration: 0.9, gain: 0.004, attack: 0.05 })
  },
  /** Channel change: short static. */
  static: (voice) => {
    noiseBurst(voice, { type: 'bandpass', frequency: 2800, q: 0.8, duration: 0.24, gain: 0.045, attack: 0.008 })
  },
}

export interface Ambience {
  stop(): void
}

/** Rain levels (plan §5.9). */
export const RAIN = {
  bed: { highpass: 400, lowpass: 5000, gain: 0.18 },
  rumble: { lowpass: 180, gain: 0.05 },
  /** Random gap between drops (ms). */
  dropGap: [30, 120],
  fadeIn: 2.5,
} as const

/**
 * Rain ambience: the noise loop band-limited to 400 Hz–5 kHz, a low rumble
 * and short band-passed "drops" every 30–120 ms, spread across the stereo
 * field. `canDrop` pauses the drops (muted, hidden, suspended context) so no
 * nodes pile up while nothing is heard.
 */
export function startRain(voice: SynthContext, timers: Timers, canDrop: () => boolean): Ambience {
  const { ctx, out, noise, random } = voice
  const t = ctx.currentTime
  const bus = ctx.createGain()
  bus.gain.setValueAtTime(SILENT, t)
  bus.gain.exponentialRampToValueAtTime(1, t + RAIN.fadeIn)
  bus.connect(out)

  const bed = ctx.createBufferSource()
  bed.buffer = noise
  bed.loop = true
  const bedHigh = filter(ctx, 'highpass', RAIN.bed.highpass)
  const bedLow = filter(ctx, 'lowpass', RAIN.bed.lowpass)
  const bedGain = ctx.createGain()
  bedGain.gain.value = RAIN.bed.gain
  bed.connect(bedHigh)
  bedHigh.connect(bedLow)
  bedLow.connect(bedGain)
  bedGain.connect(bus)

  const rumble = ctx.createBufferSource()
  rumble.buffer = noise
  rumble.loop = true
  rumble.playbackRate.value = 0.5
  const rumbleLow = filter(ctx, 'lowpass', RAIN.rumble.lowpass)
  const rumbleGain = ctx.createGain()
  rumbleGain.gain.value = RAIN.rumble.gain
  rumble.connect(rumbleLow)
  rumbleLow.connect(rumbleGain)
  rumbleGain.connect(bus)

  bed.start(t)
  rumble.start(t, noise.duration / 2)

  const dropVoice: SynthContext = { ...voice, out: bus }
  const [minGap, maxGap] = RAIN.dropGap
  let stopped = false
  let timer = 0
  const drop = () => {
    if (stopped) return
    if (canDrop()) {
      noiseBurst(dropVoice, {
        type: 'bandpass',
        frequency: 1600 + random() * 4800,
        q: 3 + random() * 6,
        duration: 0.012 + random() * 0.04,
        gain: 0.01 + random() ** 2 * 0.045,
        attack: 0.001,
        pan: random() * 1.6 - 0.8,
      })
    }
    timer = timers.set(drop, minGap + random() * (maxGap - minGap))
  }
  timer = timers.set(drop, 250)

  return {
    stop() {
      if (stopped) return
      stopped = true
      timers.clear(timer)
      const now = ctx.currentTime
      bus.gain.cancelScheduledValues(now)
      bus.gain.setTargetAtTime(0, now, 0.2)
      bed.stop(now + 1)
      rumble.stop(now + 1)
      disconnectOnEnd(bed, [bed, bedHigh, bedLow, bedGain, bus])
      disconnectOnEnd(rumble, [rumble, rumbleLow, rumbleGain])
    },
  }
}
