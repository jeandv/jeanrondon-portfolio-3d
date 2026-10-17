import { describe, expect, it, vi } from 'vitest'
import { dialPlan } from '../screens/channels/pc/dialup'
import { AudioEngine, COMPRESSOR, MASTER_LEVEL, MIN_INTERVAL_MS, MUTE_TIME_CONSTANT } from './engine'
import { impulseResponse, REVERB_SECONDS, REVERB_SEND } from './reverb'
import type { Timers } from './synth'

/* ------------------------------------------------------------------ */
/* Minimal Web Audio mock                                               */
/* ------------------------------------------------------------------ */

type Call = readonly [method: string, ...args: number[]]

class MockParam {
  value: number
  readonly calls: Call[] = []
  constructor(value = 0) {
    this.value = value
  }
  setValueAtTime(value: number, time: number) {
    this.calls.push(['setValueAtTime', value, time])
    this.value = value
    return this
  }
  setTargetAtTime(value: number, time: number, constant: number) {
    this.calls.push(['setTargetAtTime', value, time, constant])
    return this
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push(['linearRampToValueAtTime', value, time])
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push(['exponentialRampToValueAtTime', value, time])
    return this
  }
  cancelScheduledValues(time: number) {
    this.calls.push(['cancelScheduledValues', time])
    return this
  }
}

class MockNode {
  readonly outputs: unknown[] = []
  connect<T>(node: T): T {
    this.outputs.push(node)
    return node
  }
  disconnect() {
    this.outputs.length = 0
  }
}

class MockGain extends MockNode {
  readonly gain = new MockParam(1)
}

class MockCompressor extends MockNode {
  readonly threshold = new MockParam(-24)
  readonly ratio = new MockParam(12)
  readonly knee = new MockParam(30)
  readonly attack = new MockParam(0.003)
  readonly release = new MockParam(0.25)
}

class MockFilter extends MockNode {
  type = 'lowpass'
  readonly frequency = new MockParam(350)
  readonly Q = new MockParam(1)
}

class MockSource extends MockNode {
  buffer: unknown = null
  loop = false
  readonly playbackRate = new MockParam(1)
  onended: (() => void) | null = null
  start() {}
  stop() {}
}

class MockOscillator extends MockNode {
  type = 'sine'
  readonly frequency = new MockParam(440)
  onended: (() => void) | null = null
  start() {}
  stop() {}
}

class MockPanner extends MockNode {
  readonly pan = new MockParam(0)
}

class MockConvolver extends MockNode {
  buffer: { numberOfChannels: number; length: number } | null = null
  normalize = true
}

class MockContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 0
  readonly sampleRate = 8000
  readonly destination = new MockNode()
  readonly created = { gain: 0, source: 0, oscillator: 0, filter: 0 }
  readonly gains: MockGain[] = []
  readonly compressors: MockCompressor[] = []
  readonly convolvers: MockConvolver[] = []
  readonly resume = vi.fn(async () => {
    this.state = 'running'
  })
  readonly suspend = vi.fn(async () => {
    this.state = 'suspended'
  })

  createGain() {
    this.created.gain++
    const gain = new MockGain()
    this.gains.push(gain)
    return gain
  }
  createDynamicsCompressor() {
    const compressor = new MockCompressor()
    this.compressors.push(compressor)
    return compressor
  }
  createBiquadFilter() {
    this.created.filter++
    return new MockFilter()
  }
  createBufferSource() {
    this.created.source++
    return new MockSource()
  }
  createOscillator() {
    this.created.oscillator++
    return new MockOscillator()
  }
  createStereoPanner() {
    return new MockPanner()
  }
  createConvolver() {
    const convolver = new MockConvolver()
    this.convolvers.push(convolver)
    return convolver
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return {
      duration: length / sampleRate,
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel] ?? new Float32Array(length),
    }
  }
  /** Voices created so far (sources + oscillators). */
  voices(): number {
    return this.created.source + this.created.oscillator
  }
}

function setup() {
  const ctx = new MockContext()
  const createContext = vi.fn(() => ctx as unknown as AudioContext)
  let clock = 0
  const pending: Array<() => void> = []
  const timers: Timers = {
    set: (callback) => pending.push(callback),
    clear: () => undefined,
  }
  const engine = new AudioEngine({ createContext, now: () => clock, random: () => 0.5, timers })
  const master = () => ctx.gains[0]
  return {
    ctx,
    engine,
    createContext,
    master,
    pending,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

/* ------------------------------------------------------------------ */

describe('AudioEngine', () => {
  it('never creates the AudioContext before a gesture', () => {
    const { engine, createContext } = setup()
    expect(engine.play('tick')).toBe(false)
    engine.setMuted(false)
    engine.setHidden(true)
    engine.setHidden(false)
    expect(createContext).not.toHaveBeenCalled()
    expect(engine.unlocked).toBe(false)
  })

  it('builds master → compressor → destination once, on unlock', () => {
    const { ctx, engine, createContext, master } = setup()
    engine.unlock()
    engine.unlock()
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(engine.unlocked).toBe(true)
    const [compressor] = ctx.compressors
    expect(compressor?.threshold.value).toBe(COMPRESSOR.threshold)
    expect(compressor?.ratio.value).toBe(COMPRESSOR.ratio)
    expect(compressor?.knee.value).toBe(COMPRESSOR.knee)
    expect(compressor?.attack.value).toBe(COMPRESSOR.attack)
    expect(compressor?.release.value).toBe(COMPRESSOR.release)
    expect(compressor?.outputs).toContain(ctx.destination)
    expect(master()?.outputs).toContain(compressor)
  })

  it('ENTER MUTED: the master stays at 0 and nothing plays', () => {
    const { ctx, engine, master, pending } = setup()
    engine.setMuted(true)
    engine.unlock()
    expect(master()?.gain.value).toBe(0)
    const voices = ctx.voices()
    expect(engine.play('power')).toBe(false)
    expect(engine.play('tick')).toBe(false)
    expect(ctx.voices()).toBe(voices)
    // No rain while muted.
    expect(pending).toHaveLength(0)
  })

  it('entering with sound starts at full level (no ramp-in) and starts the rain', () => {
    const { ctx, engine, master, pending } = setup()
    engine.setMuted(false)
    engine.unlock()
    expect(master()?.gain.value).toBe(MASTER_LEVEL)
    expect(master()?.gain.calls).toHaveLength(0)
    expect(pending).toHaveLength(1)
    expect(engine.play('power')).toBe(true)
    expect(ctx.voices()).toBeGreaterThan(2)
  })

  it('ramps the master with setTargetAtTime when muting and unmuting', () => {
    const { ctx, engine, master } = setup()
    engine.setMuted(false)
    engine.unlock()
    ctx.currentTime = 3
    engine.setMuted(true)
    expect(master()?.gain.calls).toEqual([
      ['cancelScheduledValues', 3],
      ['setValueAtTime', MASTER_LEVEL, 3],
      ['setTargetAtTime', 0, 3, MUTE_TIME_CONSTANT],
    ])
    ctx.currentTime = 4
    engine.setMuted(false)
    expect(master()?.gain.calls.at(-1)).toEqual(['setTargetAtTime', MASTER_LEVEL, 4, MUTE_TIME_CONSTANT])
  })

  it('throttles the hover tick to one per 60 ms', () => {
    const { engine, advance } = setup()
    engine.setMuted(false)
    engine.unlock()
    expect(MIN_INTERVAL_MS.tick).toBe(60)
    expect(engine.play('tick')).toBe(true)
    advance(30)
    expect(engine.play('tick')).toBe(false)
    // Other sounds are not held back by the tick throttle.
    expect(engine.play('click')).toBe(true)
    expect(engine.play('click')).toBe(true)
    advance(30)
    expect(engine.play('tick')).toBe(true)
  })

  it('suspends with the tab hidden and resumes when visible', () => {
    const { ctx, engine } = setup()
    engine.setMuted(false)
    engine.unlock()
    engine.setHidden(true)
    expect(ctx.suspend).toHaveBeenCalledTimes(1)
    expect(engine.play('click')).toBe(false)
    engine.setHidden(false)
    expect(ctx.resume).toHaveBeenCalled()
    expect(engine.play('click')).toBe(true)
  })

  it('auto-entered visitors unlock on their first gesture', () => {
    const { engine, createContext } = setup()
    const target = new EventTarget()
    engine.unlockOnGesture(target)
    expect(createContext).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('pointerdown'))
    expect(createContext).toHaveBeenCalledTimes(1)
    target.dispatchEvent(new Event('keydown'))
    expect(createContext).toHaveBeenCalledTimes(1)
  })

  it('stays silent without Web Audio', () => {
    const engine = new AudioEngine({ createContext: () => null })
    engine.unlock()
    expect(engine.unlocked).toBe(false)
    expect(engine.play('click')).toBe(false)
  })
})

describe('convolution reverb', () => {
  it('is only built on unlock: a 0.9 s stereo IR in a convolver returning into the master', () => {
    const { ctx, engine, master } = setup()
    engine.setMuted(false)
    expect(engine.play('click')).toBe(false)
    expect(ctx.convolvers).toHaveLength(0)
    engine.unlock()
    engine.unlock()
    expect(ctx.convolvers).toHaveLength(1)
    const [convolver] = ctx.convolvers
    expect(convolver?.buffer?.numberOfChannels).toBe(2)
    expect(convolver?.buffer?.length).toBe(Math.floor(ctx.sampleRate * REVERB_SECONDS))
    expect(convolver?.outputs).toEqual([master()])
  })

  it('one-shots get a small wet send; the rain stays dry', () => {
    const { ctx, engine, master } = setup()
    engine.setMuted(false)
    engine.unlock()
    const [convolver] = ctx.convolvers
    // The rain bus (first gain after the master) goes straight to the master.
    const rain = ctx.gains[1]
    expect(rain?.outputs).toEqual([master()])

    expect(engine.play('click')).toBe(true)
    const sends = ctx.gains.filter((gain) => gain.outputs.includes(convolver))
    expect(sends).toHaveLength(1)
    expect(sends[0]?.gain.value).toBe(REVERB_SEND.click)
    const bus = ctx.gains.find((gain) => sends[0] !== undefined && gain.outputs.includes(sends[0]))
    expect(bus?.outputs).toEqual([master(), sends[0]])
    // The same send level reuses its bus; another level gets its own.
    engine.play('tick')
    engine.play('key')
    expect(ctx.gains.filter((gain) => gain.outputs.includes(convolver))).toHaveLength(2)
    for (const level of Object.values(REVERB_SEND)) {
      expect(level).toBeGreaterThanOrEqual(0.12)
      expect(level).toBeLessThanOrEqual(0.18)
    }
  })

  it('plays everything dry when the convolver is missing', () => {
    const ctx = new MockContext()
    const broken = Object.assign(ctx, {
      createConvolver: () => {
        throw new Error('no convolver')
      },
    })
    const engine = new AudioEngine({ createContext: () => broken as unknown as AudioContext, random: () => 0.5, timers: { set: () => 0, clear: () => undefined } })
    engine.setMuted(false)
    engine.unlock()
    expect(engine.play('click')).toBe(true)
  })

  it('the modem: nothing while muted, otherwise a wet bus and a stop', () => {
    const { ctx, engine } = setup()
    engine.setMuted(true)
    engine.unlock()
    const before = ctx.voices()
    engine.startModem(dialPlan())()
    expect(ctx.voices()).toBe(before)
    engine.setMuted(false)
    const stop = engine.startModem(dialPlan())
    expect(ctx.voices()).toBeGreaterThan(before + 10)
    expect(ctx.gains.some((gain) => gain.gain.value === REVERB_SEND.modem && gain.outputs.includes(ctx.convolvers[0]))).toBe(true)
    expect(() => stop()).not.toThrow()
  })
})

describe('impulse response', () => {
  it('follows the reference: (rand·2−1)·(1−i/len)^3.2·0.6, stereo', () => {
    const channels = impulseResponse(1000, () => 1, 0.9)
    expect(channels).toHaveLength(2)
    const [left] = channels
    expect(left?.length).toBe(900)
    expect(left?.[0]).toBeCloseTo(0.6)
    expect(left?.[450]).toBeCloseTo(0.6 * 0.5 ** 3.2)
    expect(left?.[899]).toBeCloseTo(0.6 * (1 / 900) ** 3.2, 8)
    const silent = impulseResponse(1000, () => 0.5)
    expect(silent[1]?.every((value) => value === 0)).toBe(true)
  })
})
