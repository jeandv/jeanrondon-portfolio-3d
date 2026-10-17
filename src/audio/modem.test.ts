import { describe, expect, it, vi } from 'vitest'
import { dialPlan, dialTones } from '../screens/channels/pc/dialup'
import { ANSWER_TONE, DTMF_COLS, DTMF_ROWS, dtmfPair, MODEM_LEVEL, RINGBACK, startModem } from './modem'

describe('DTMF table (ITU-T Q.23)', () => {
  it('pairs every key with its row and column frequency', () => {
    expect(DTMF_ROWS).toEqual([697, 770, 852, 941])
    expect(DTMF_COLS).toEqual([1209, 1336, 1477, 1633])
    const table: Record<string, [number, number]> = {
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      A: [697, 1633],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      B: [770, 1633],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      C: [852, 1633],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477],
      D: [941, 1633],
    }
    for (const [key, pair] of Object.entries(table)) expect(dtmfPair(key), key).toEqual(pair)
    expect(dtmfPair('d')).toEqual([941, 1633])
    expect(dtmfPair('x')).toBeNull()
    expect(dtmfPair('12')).toBeNull()
    expect(dtmfPair('')).toBeNull()
  })

  it('uses the North American ringback and the V.25 answer tone', () => {
    expect([...RINGBACK]).toEqual([440, 480])
    expect(ANSWER_TONE).toBe(2100)
  })
})

/* Minimal Web Audio stand-in: records oscillator frequencies and stops. */
class Param {
  value = 0
  setValueAtTime(value: number) {
    this.value = value
    return this
  }
  linearRampToValueAtTime() {
    return this
  }
  exponentialRampToValueAtTime() {
    return this
  }
  setTargetAtTime() {
    return this
  }
  cancelScheduledValues() {
    return this
  }
}

class Node {
  readonly outputs: unknown[] = []
  connect<T>(node: T): T {
    this.outputs.push(node)
    return node
  }
  disconnect() {
    this.outputs.length = 0
  }
}

class Source extends Node {
  type = 'sine'
  buffer: unknown = null
  loop = false
  readonly frequency = new Param()
  onended: (() => void) | null = null
  readonly stops: number[] = []
  start() {}
  stop(when = 0) {
    this.stops.push(when)
  }
}

function mockContext() {
  const oscillators: Source[] = []
  const sources: Source[] = []
  const gains: Array<Node & { gain: Param }> = []
  const ctx = {
    currentTime: 10,
    createGain: () => {
      const gain = Object.assign(new Node(), { gain: new Param() })
      gains.push(gain)
      return gain
    },
    createOscillator: () => {
      const osc = new Source()
      oscillators.push(osc)
      return osc
    },
    createBufferSource: () => {
      const source = new Source()
      sources.push(source)
      return source
    },
    createBiquadFilter: () => Object.assign(new Node(), { type: 'lowpass', frequency: new Param(), Q: new Param() }),
  }
  return { ctx, oscillators, sources, gains }
}

describe('modem sequence', () => {
  it('schedules two DTMF tones per digit, the ringback, the answer tone and the screech, on a quiet bus', () => {
    const { ctx, oscillators, sources, gains } = mockContext()
    const out = new Node()
    const stop = startModem({ ctx: ctx as unknown as BaseAudioContext, out: out as unknown as AudioNode, noise: {} as AudioBuffer, random: () => 0.5 }, dialPlan())
    const bus = gains[0]
    expect(bus?.gain.value).toBe(MODEM_LEVEL)
    expect(out.outputs).toHaveLength(0)
    expect(bus?.outputs).toContain(out)

    const frequencies = oscillators.map((osc) => osc.frequency.value)
    for (const tone of dialTones()) {
      const pair = dtmfPair(tone.key)
      expect(frequencies).toEqual(expect.arrayContaining([pair?.[0], pair?.[1]]))
    }
    expect(frequencies.filter((f) => f === 440)).toHaveLength(dialPlan().rings.length)
    expect(frequencies).toContain(ANSWER_TONE)
    expect(sources).toHaveLength(1) // the band-passed hiss

    stop()
    stop()
    // Every voice is cut once, right away.
    for (const voice of [...oscillators, ...sources]) expect(voice.stops.at(-1)).toBeCloseTo(ctx.currentTime + 0.06)
    expect(oscillators[0]?.stops).toHaveLength(2) // its scheduled end, then the cut
  })

  it('cleans its bus up once every voice has ended', () => {
    const { ctx, oscillators, sources, gains } = mockContext()
    const out = new Node()
    startModem({ ctx: ctx as unknown as BaseAudioContext, out: out as unknown as AudioNode, noise: {} as AudioBuffer, random: () => 0.5 }, dialPlan())
    const bus = gains[0]
    const disconnect = vi.spyOn(bus as Node, 'disconnect')
    for (const voice of [...oscillators, ...sources]) voice.onended?.()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
