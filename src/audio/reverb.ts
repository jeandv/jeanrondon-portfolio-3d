import type { SoundId } from './sfx'

/**
 * Small-room reverb (plan §1 Audio, §10.12): a ConvolverNode fed by a
 * generated impulse response, like the reference: stereo noise with a
 * (1 − i/len)^3.2 decay over ~0.9 s. The UI one-shots and the modem get a
 * small wet send; the rain ambience stays dry.
 */

export const REVERB_SECONDS = 0.9
/** Decay curve exponent and peak level of the reference IR: (rand·2−1)·(1−i/len)^3.2·0.6. */
export const IR_DECAY = 3.2
export const IR_PEAK = 0.6

/** Wet send per sound (0 = dry). */
export const REVERB_SEND: Readonly<Record<SoundId | 'modem', number>> = {
  tick: 0.12,
  key: 0.12,
  click: 0.14,
  tape: 0.16,
  eject: 0.15,
  lamp: 0.15,
  power: 0.14,
  static: 0.12,
  sip: 0.16,
  clink: 0.18,
  clock: 0.12,
  card: 0.14,
  modem: 0.15,
}

/** The impulse response samples, one array per channel (pure; `random` in [0, 1)). */
export function impulseResponse(
  sampleRate: number,
  random: () => number,
  seconds = REVERB_SECONDS,
  channels = 2,
): Float32Array[] {
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  return Array.from({ length: channels }, () => {
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * (1 - i / length) ** IR_DECAY * IR_PEAK
    return data
  })
}

/** A ConvolverNode loaded with the generated stereo impulse response. */
export function createReverb(ctx: BaseAudioContext, random: () => number): ConvolverNode {
  const channels = impulseResponse(ctx.sampleRate, random)
  const buffer = ctx.createBuffer(channels.length, channels[0]?.length ?? 1, ctx.sampleRate)
  channels.forEach((data, channel) => buffer.getChannelData(channel).set(data))
  const convolver = ctx.createConvolver()
  convolver.buffer = buffer
  return convolver
}
