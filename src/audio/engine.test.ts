import { describe, expect, it, vi } from 'vitest'
import { AudioEngine, COMPRESSOR, MASTER_LEVEL, MIN_INTERVAL_MS, MUTE_TIME_CONSTANT } from './engine'
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

class MockContext {
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 0
  readonly sampleRate = 8000
  readonly destination = new MockNode()
  readonly created = { gain: 0, source: 0, oscillator: 0, filter: 0 }
  readonly gains: MockGain[] = []
  readonly compressors: MockCompressor[] = []
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
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { duration: length / sampleRate, length, sampleRate, numberOfChannels: 1, getChannelData: () => data }
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
