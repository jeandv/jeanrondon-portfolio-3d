import type { SynthContext } from './synth'

/**
 * Dial-up modem for the BBS on #online (plan §10.9): DTMF digits, the
 * ringback, then the answer tone and the handshake screech. Scheduled on a
 * private bus so the whole sequence can be cut at once (skip / leaving).
 */

/** DTMF keypad (ITU-T Q.23): row frequency + column frequency per key. */
export const DTMF_ROWS = [697, 770, 852, 941] as const
export const DTMF_COLS = [1209, 1336, 1477, 1633] as const
const KEYPAD = ['123A', '456B', '789C', '*0#D'] as const

/** The two frequencies (Hz) of a keypad key, low (row) first; null for anything else. */
export function dtmfPair(key: string): readonly [low: number, high: number] | null {
  if (key.length !== 1) return null
  for (let row = 0; row < KEYPAD.length; row++) {
    const col = KEYPAD[row]?.indexOf(key.toUpperCase()) ?? -1
    const low = DTMF_ROWS[row]
    const high = DTMF_COLS[col]
    if (col >= 0 && low !== undefined && high !== undefined) return [low, high]
  }
  return null
}

/** North American ringback: 440 + 480 Hz. */
export const RINGBACK = [440, 480] as const
/** The answering modem's tone (V.25 answer tone). */
export const ANSWER_TONE = 2100
/** Seconds of answer tone at the start of the handshake. */
export const ANSWER_SECONDS = 0.32

/** Low: the modem sits under the UI sounds. */
export const MODEM_LEVEL = 0.06

export interface DialTone {
  readonly key: string
  /** Seconds from the start of the sequence. */
  readonly start: number
  readonly end: number
}

/** When each part sounds (seconds from the start), shared with the BBS screen's script. */
export interface DialPlan {
  readonly tones: readonly DialTone[]
  readonly rings: readonly (readonly [start: number, end: number])[]
  readonly handshake: readonly [start: number, end: number]
}

const SILENT = 0.0001

/** Starts the sequence on `voice.out`; returns stop (a 10 ms fade, idempotent). */
export function startModem(voice: SynthContext, plan: DialPlan): () => void {
  const { ctx, noise } = voice
  const t0 = ctx.currentTime
  const bus = ctx.createGain()
  bus.gain.value = MODEM_LEVEL
  bus.connect(voice.out)

  const sources: AudioScheduledSourceNode[] = []
  let live = 0
  const track = (source: AudioScheduledSourceNode, nodes: readonly AudioNode[]) => {
    sources.push(source)
    live++
    source.onended = () => {
      for (const node of nodes) node.disconnect()
      live--
      if (live === 0) bus.disconnect()
    }
  }

  /** A held tone with 5 ms edges. */
  const hold = (frequency: number, start: number, end: number, gain: number, type: OscillatorType = 'sine') => {
    const a = t0 + start
    const b = t0 + Math.max(start + 0.02, end)
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(frequency, a)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0, a)
    amp.gain.linearRampToValueAtTime(gain, a + 0.005)
    amp.gain.setValueAtTime(gain, b - 0.005)
    amp.gain.linearRampToValueAtTime(0, b)
    osc.connect(amp)
    amp.connect(bus)
    osc.start(a)
    osc.stop(b + 0.01)
    track(osc, [osc, amp])
    return osc
  }

  for (const tone of plan.tones) {
    const pair = dtmfPair(tone.key)
    if (!pair) continue
    hold(pair[0], tone.start, tone.end, 0.5)
    hold(pair[1], tone.start, tone.end, 0.5)
  }
  for (const [start, end] of plan.rings) {
    for (const frequency of RINGBACK) hold(frequency, start, end, 0.32)
  }

  const [hs, he] = plan.handshake
  hold(ANSWER_TONE, hs, hs + ANSWER_SECONDS, 0.45)
  const screech = hs + ANSWER_SECONDS + 0.04
  // Carrier pair under the whole screech, a rising probe sweep, a few "bongs".
  hold(1800, screech, he, 0.22, 'square')
  hold(2400, screech + 0.12, he, 0.16, 'square')
  const sweep = hold(600, screech, screech + 0.35, 0.18, 'sawtooth')
  sweep.frequency.exponentialRampToValueAtTime(2900, t0 + screech + 0.35)
  for (let i = 0; i < 3; i++) hold(1200 + i * 220, screech + 0.4 + i * 0.16, screech + 0.48 + i * 0.16, 0.25, 'triangle')

  // Band-passed noise: the hiss of the training sequence.
  const hiss = ctx.createBufferSource()
  hiss.buffer = noise
  hiss.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2100
  band.Q.value = 1.4
  const hissAmp = ctx.createGain()
  hissAmp.gain.setValueAtTime(SILENT, t0 + screech)
  hissAmp.gain.exponentialRampToValueAtTime(0.9, t0 + screech + 0.08)
  hissAmp.gain.setValueAtTime(0.9, t0 + he - 0.06)
  hissAmp.gain.exponentialRampToValueAtTime(SILENT, t0 + he)
  hiss.connect(band)
  band.connect(hissAmp)
  hissAmp.connect(bus)
  hiss.start(t0 + screech)
  hiss.stop(t0 + he + 0.02)
  track(hiss, [hiss, band, hissAmp])

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const now = ctx.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.setTargetAtTime(0, now, 0.01)
    for (const source of sources) {
      try {
        source.stop(now + 0.06)
      } catch {
        // Already ended.
      }
    }
  }
}
