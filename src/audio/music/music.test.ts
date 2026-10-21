import { describe, expect, it } from 'vitest'
import { MUSIC } from '../../content/music'
import { CD_STOPPED, cdPress, type CdState } from '../../three/objects/cd/player'
import { composeTrack, type NoteEvent, type VoiceId } from './compose'
import { MusicEngine } from './engine'
import { createRng } from './rng'
import { LOOKAHEAD_SECONDS, LookaheadScheduler, type IntervalTimers } from './scheduler'
import { bassRoot, nearest, voiceChord } from './theory'
import { FORM, sectionOf, stepSeconds, STEPS_PER_BAR, swingDelay, TRACK_SECONDS, TRACKS, trackSeconds, trackSteps } from './tracks'
import { stepsInWindow, type StepTick } from './transport'

const eventsOf = (voice: VoiceId, steps: readonly (readonly NoteEvent[])[]) => steps.flat().filter((event) => event.voice === voice)

describe('tracks', () => {
  it('three tracks, 70–85 BPM, one title each in src/content/music.ts', () => {
    expect(TRACKS).toHaveLength(3)
    expect(MUSIC.tracks).toHaveLength(TRACKS.length)
    for (const spec of TRACKS) {
      expect(spec.bpm).toBeGreaterThanOrEqual(70)
      expect(spec.bpm).toBeLessThanOrEqual(85)
      expect(spec.bars).toBe(FORM.reduce((sum, [, bars]) => sum + bars, 0))
    }
    expect(new Set(TRACKS.map((spec) => spec.seed)).size).toBe(TRACKS.length)
  })

  it('a track lasts its bars of 16ths; about two minutes each', () => {
    for (const [i, spec] of TRACKS.entries()) {
      expect(trackSeconds(spec)).toBeCloseTo(trackSteps(spec) * stepSeconds(spec), 9)
      expect(TRACK_SECONDS[i]).toBe(trackSeconds(spec))
      expect(trackSeconds(spec)).toBeGreaterThan(100)
      expect(trackSeconds(spec)).toBeLessThan(150)
    }
  })

  it('swing delays only the off-beat 16ths', () => {
    const spec = TRACKS[0]
    if (!spec) throw new Error('no track')
    expect(swingDelay(spec, 0)).toBe(0)
    expect(swingDelay(spec, 2)).toBe(0)
    expect(swingDelay(spec, 1)).toBeCloseTo(spec.swing * stepSeconds(spec))
  })

  it('the form: intro, A, B, A, B, outro', () => {
    expect(sectionOf(0)).toEqual({ section: 'intro', barInSection: 0, pass: 0 })
    expect(sectionOf(4)).toEqual({ section: 'A', barInSection: 0, pass: 0 })
    expect(sectionOf(12)).toEqual({ section: 'B', barInSection: 0, pass: 0 })
    expect(sectionOf(27)).toEqual({ section: 'A', barInSection: 7, pass: 1 })
    expect(sectionOf(39)).toEqual({ section: 'outro', barInSection: 3, pass: 0 })
  })
})

describe('harmony', () => {
  it('voices chords close around the middle of the keyboard, with the root in the bass', () => {
    const dm9 = voiceChord({ root: 2, quality: 'm9' }, 0)
    expect(dm9.map((n) => n % 12).sort((a, b) => a - b)).toEqual([0, 4, 5, 9]) // F A C E
    expect(Math.max(...dm9) - Math.min(...dm9)).toBeLessThanOrEqual(12)
    expect(bassRoot({ root: 7, quality: '13' }, 0) % 12).toBe(7)
    expect(nearest(0, 63)).toBe(60)
    expect(nearest(5, 63)).toBe(65)
  })
})

describe('composition', () => {
  it('is deterministic per seed and differs between seeds', () => {
    for (const spec of TRACKS) expect(composeTrack(spec)).toEqual(composeTrack(spec))
    const [a, b] = TRACKS
    if (!a || !b) throw new Error('no tracks')
    const other = composeTrack({ ...a, seed: a.seed + 1 })
    expect(other.steps).not.toEqual(composeTrack(a).steps)
    expect(composeTrack(a).steps).not.toEqual(composeTrack(b).steps)
  })

  it('the same seed always draws the same random sequence', () => {
    const one = createRng(42)
    const two = createRng(42)
    const draws = Array.from({ length: 50 }, () => one())
    expect(Array.from({ length: 50 }, () => two())).toEqual(draws)
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true)
  })

  it('writes a chord per bar (or a split ii–V) and keeps every event in range', () => {
    for (const spec of TRACKS) {
      const song = composeTrack(spec)
      expect(song.bars).toHaveLength(spec.bars)
      expect(song.steps).toHaveLength(trackSteps(spec))
      for (const chords of song.bars) {
        expect(chords.length === 1 || chords.length === 2).toBe(true)
        expect(chords[0]?.step).toBe(0)
      }
      for (const event of song.steps.flat()) {
        expect(event.velocity).toBeGreaterThan(0)
        expect(event.velocity).toBeLessThanOrEqual(1)
        expect(event.length).toBeGreaterThanOrEqual(1)
        expect(event.nudge).toBeGreaterThanOrEqual(0)
        expect(event.nudge).toBeLessThan(0.08)
      }
      for (const note of eventsOf('keys', song.steps)) {
        expect(note.midi).toBeGreaterThanOrEqual(52)
        expect(note.midi).toBeLessThanOrEqual(76)
      }
      for (const note of eventsOf('bass', song.steps)) {
        expect(note.midi).toBeGreaterThanOrEqual(35)
        expect(note.midi).toBeLessThanOrEqual(60)
      }
    }
  })

  it('a lazy kit: backbeat snares on 2 and 4, 8th-note hats, no drums in the first bars', () => {
    const spec = TRACKS[0]
    if (!spec) throw new Error('no track')
    const song = composeTrack(spec)
    const bar = (index: number) => song.steps.slice(index * STEPS_PER_BAR, (index + 1) * STEPS_PER_BAR)
    // Bar 5 (A section): snare on steps 4 and 12, hats on the 8ths.
    const groove = bar(5)
    expect(groove[4]?.some((event) => event.voice === 'snare')).toBe(true)
    expect(groove[12]?.some((event) => event.voice === 'snare')).toBe(true)
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
      expect(groove[step]?.some((event) => event.voice === 'hat' || event.voice === 'openhat')).toBe(true)
    }
    expect(groove[0]?.some((event) => event.voice === 'kick')).toBe(true)
    // Intro: keys first, no kick or snare in its first two bars.
    for (const step of [...bar(0), ...bar(1)]) expect(step.some((event) => event.voice === 'kick' || event.voice === 'snare')).toBe(false)
    expect(bar(0)[0]?.some((event) => event.voice === 'keys')).toBe(true)
  })

  it('keeps the polyphony low: at most one chord, one bass note, one lead note and two drums per step', () => {
    for (const spec of TRACKS) {
      for (const step of composeTrack(spec).steps) {
        expect(step.filter((event) => event.voice === 'keys').length).toBeLessThanOrEqual(4)
        expect(step.filter((event) => event.voice === 'bass').length).toBeLessThanOrEqual(1)
        expect(step.filter((event) => event.voice === 'lead').length).toBeLessThanOrEqual(1)
        expect(step.filter((event) => !['keys', 'bass', 'lead'].includes(event.voice)).length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('a melody plays in the B sections only', () => {
    for (const spec of TRACKS) {
      const song = composeTrack(spec)
      const leadBars = new Set(
        song.steps.flatMap((events, index) => (events.some((event) => event.voice === 'lead') ? [Math.floor(index / STEPS_PER_BAR)] : [])),
      )
      expect(leadBars.size).toBeGreaterThan(4)
      for (const bar of leadBars) expect(sectionOf(bar).section).toBe('B')
    }
  })
})

/* ------------------------------------------------------------------ */
/* Transport and scheduler                                             */
/* ------------------------------------------------------------------ */

const LENGTHS = TRACKS.map(trackSeconds)
const playingAt = (now: number): CdState => cdPress(CD_STOPPED, 'play', LENGTHS, now)

describe('transport: the disc on the audio clock', () => {
  it('nothing unless playing', () => {
    expect(stepsInWindow(CD_STOPPED, TRACKS, 0, 100)).toEqual([])
    const paused = cdPress(playingAt(0), 'pause', LENGTHS, 3)
    expect(stepsInWindow(paused, TRACKS, 0, 100)).toEqual([])
  })

  it('maps the grid from `since`, swing on the off-beats', () => {
    const spec = TRACKS[0]
    if (!spec) throw new Error('no track')
    const sd = stepSeconds(spec)
    const ticks = stepsInWindow(playingAt(10), TRACKS, 10, 10 + sd * 4)
    expect(ticks.map((tick) => tick.step)).toEqual([0, 1, 2, 3])
    expect(ticks[0]?.time).toBeCloseTo(10)
    expect(ticks[1]?.time).toBeCloseTo(10 + sd + spec.swing * sd)
    expect(ticks[2]?.time).toBeCloseTo(10 + 2 * sd)
  })

  it('contiguous windows book every step exactly once, across a track change', () => {
    const state = playingAt(0)
    const first = TRACK_SECONDS[0] ?? 0
    const all: StepTick[] = []
    // Ragged windows (like a jittery timer) around the end of track 1.
    let t = first - 3
    let i = 0
    while (t < first + 3) {
      const next = t + 0.013 + (i++ % 5) * 0.011
      stepsInWindow(state, TRACKS, t, next, all)
      t = next
    }
    const keys = all.map((tick) => `${tick.track}:${tick.step}`)
    expect(new Set(keys).size).toBe(keys.length)
    const lastOfFirst = all.filter((tick) => tick.track === 0).map((tick) => tick.step)
    const firstOfSecond = all.filter((tick) => tick.track === 1).map((tick) => tick.step)
    const spec0 = TRACKS[0]
    if (!spec0) throw new Error('no track')
    expect(lastOfFirst.at(-1)).toBe(trackSteps(spec0) - 1)
    expect(firstOfSecond[0]).toBe(0)
    // No gap: consecutive steps.
    for (let k = 1; k < lastOfFirst.length; k++) expect((lastOfFirst[k] ?? 0) - (lastOfFirst[k - 1] ?? 0)).toBe(1)
  })

  it('a paused-then-resumed disc continues where it was', () => {
    const spec = TRACKS[0]
    if (!spec) throw new Error('no track')
    const sd = stepSeconds(spec)
    const paused = cdPress(playingAt(0), 'pause', LENGTHS, sd * 10)
    const resumed = cdPress(paused, 'play', LENGTHS, 50)
    expect(stepsInWindow(resumed, TRACKS, 50, 50 + sd * 0.5).map((tick) => tick.step)).toEqual([10])
  })
})

/** Interval timers driven by hand. */
function manualTimers() {
  const callbacks = new Map<number, () => void>()
  let next = 1
  const timers: IntervalTimers = {
    every: (callback) => {
      callbacks.set(next, callback)
      return next++
    },
    cancel: (id) => callbacks.delete(id),
  }
  return { timers, fire: () => [...callbacks.values()].forEach((callback) => callback()), count: () => callbacks.size }
}

describe('look-ahead scheduler', () => {
  it('books [now, now + lookahead) and then only what is new, never a window twice', () => {
    let now = 5
    const windows: [number, number][] = []
    const { timers, fire } = manualTimers()
    const scheduler = new LookaheadScheduler({ now: () => now, timers, onWindow: (from, to) => windows.push([from, to]) })
    scheduler.start()
    expect(windows).toEqual([[5, 5 + LOOKAHEAD_SECONDS]])
    fire()
    expect(windows).toHaveLength(1)
    now = 5.025
    fire()
    expect(windows[1]?.[0]).toBeCloseTo(5 + LOOKAHEAD_SECONDS)
    expect(windows[1]?.[1]).toBeCloseTo(5.025 + LOOKAHEAD_SECONDS)
    for (let k = 1; k < windows.length; k++) expect(windows[k]?.[0]).toBe(windows[k - 1]?.[1])
    // Never further ahead than the look-ahead.
    expect(scheduler.scheduledUntil - now).toBeLessThanOrEqual(LOOKAHEAD_SECONDS + 1e-9)
  })

  it('a late wake-up skips the past instead of booking it all at once', () => {
    let now = 0
    const windows: [number, number][] = []
    const { timers, fire } = manualTimers()
    const scheduler = new LookaheadScheduler({ now: () => now, timers, onWindow: (from, to) => windows.push([from, to]) })
    scheduler.start()
    now = 2
    fire()
    expect(windows.at(-1)).toEqual([2, 2 + LOOKAHEAD_SECONDS])
  })

  it('stopped: no timer, nothing booked', () => {
    let now = 0
    const windows: [number, number][] = []
    const { timers, fire, count } = manualTimers()
    const scheduler = new LookaheadScheduler({ now: () => now, timers, onWindow: (from, to) => windows.push([from, to]) })
    scheduler.start()
    scheduler.stop()
    expect(scheduler.running).toBe(false)
    expect(count()).toBe(0)
    now = 1
    fire()
    scheduler.tick()
    expect(windows).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* Engine (with a minimal Web Audio mock)                               */
/* ------------------------------------------------------------------ */

class Param {
  value = 0
  setValueAtTime() {
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
  connect<T>(target: T): T {
    return target
  }
  disconnect() {}
}
class Source extends Node {
  buffer: unknown = null
  loop = false
  type = 'sine'
  readonly frequency = new Param()
  readonly detune = new Param()
  onended: (() => void) | null = null
  start() {}
  stop() {}
}
class MockAudio {
  currentTime = 0
  sources = 0
  createGain() {
    return Object.assign(new Node(), { gain: new Param() })
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(), Q: new Param() })
  }
  createOscillator() {
    this.sources++
    return new Source()
  }
  createBufferSource() {
    this.sources++
    return new Source()
  }
}

function engineSetup() {
  const ctx = new MockAudio()
  const { timers, fire } = manualTimers()
  const engine = new MusicEngine({
    ctx: ctx as unknown as BaseAudioContext,
    out: new Node() as unknown as AudioNode,
    send: null,
    noise: { duration: 2 } as AudioBuffer,
    random: () => 0.5,
    timers,
  })
  return { ctx, engine, fire }
}

describe('music engine', () => {
  it('books nothing until the disc plays, then voices on each wake-up', () => {
    const { ctx, engine, fire } = engineSetup()
    const idle = ctx.sources
    engine.sync(CD_STOPPED)
    fire()
    expect(engine.scheduling).toBe(false)
    expect(ctx.sources).toBe(idle)
    engine.sync(playingAt(0))
    expect(engine.scheduling).toBe(true)
    expect(ctx.sources).toBeGreaterThan(idle)
  })

  it('pause stops scheduling: wake-ups book nothing more', () => {
    const { ctx, engine, fire } = engineSetup()
    const playing = playingAt(0)
    engine.sync(playing)
    ctx.currentTime = 10
    fire()
    engine.sync(cdPress(playing, 'pause', LENGTHS, 10))
    expect(engine.scheduling).toBe(false)
    const before = ctx.sources
    ctx.currentTime = 20
    fire()
    expect(ctx.sources).toBe(before)
  })

  it('muted keeps the place but books no voices', () => {
    const { ctx, engine, fire } = engineSetup()
    engine.setMuted(true)
    engine.sync(playingAt(0))
    const before = ctx.sources
    for (let t = 1; t < 30; t += 0.025) {
      ctx.currentTime = t
      fire()
    }
    expect(engine.scheduling).toBe(true)
    expect(ctx.sources).toBe(before)
  })

  it('a settled state of the same cursor does not restart the track', () => {
    const { ctx, engine } = engineSetup()
    const playing = playingAt(0)
    engine.sync(playing)
    ctx.currentTime = 4
    const created = ctx.sources
    // Equivalent state (rebased): no re-sync, so nothing new is booked here.
    engine.sync({ ...playing, position: 4, since: 4 })
    expect(ctx.sources).toBe(created)
  })
})
