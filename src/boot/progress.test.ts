import { describe, expect, it } from 'vitest'
import {
  GATE_FRAMES,
  gateReady,
  INITIAL_SIGNALS,
  MAX_BEFORE_GATE,
  NETWORK_SHARE,
  percentOf,
  progressTarget,
  STEP_SHARE,
  stepDisplayed,
  type BootSignals,
} from './progress'

const signals = (patch: Partial<BootSignals>): BootSignals => ({ ...INITIAL_SIGNALS, ...patch })

const READY = signals({ network: 1, assets: true, fonts: true, compiled: true, frames: GATE_FRAMES })

describe('progressTarget (80/20 split)', () => {
  it('maps network bytes onto the first 80%, short of 80% until the assets are in', () => {
    expect(progressTarget(signals({ network: 0 }))).toBe(0)
    expect(progressTarget(signals({ network: 0.5 }))).toBeCloseTo(0.4)
    expect(progressTarget(signals({ network: 1 }))).toBeLessThan(NETWORK_SHARE)
    expect(progressTarget(signals({ network: 7 }))).toBeLessThan(NETWORK_SHARE)
    expect(progressTarget(signals({ network: Number.NaN }))).toBe(0)
  })

  it('adds fonts, compile and frames on top of 80% only once the assets are in', () => {
    // Fonts settling early does not move the bar past the network share.
    expect(progressTarget(signals({ network: 0.5, fonts: true }))).toBeCloseTo(0.4)
    expect(progressTarget(signals({ network: 1, assets: true }))).toBeCloseTo(NETWORK_SHARE)
    expect(progressTarget(signals({ network: 1, assets: true, fonts: true }))).toBeCloseTo(NETWORK_SHARE + STEP_SHARE.fonts)
    expect(progressTarget(signals({ network: 1, assets: true, fonts: true, compiled: true }))).toBeCloseTo(
      NETWORK_SHARE + STEP_SHARE.fonts + STEP_SHARE.compiled,
    )
    expect(progressTarget(signals({ network: 1, assets: true, fonts: true, compiled: true, frames: 1 }))).toBeCloseTo(
      NETWORK_SHARE + STEP_SHARE.fonts + STEP_SHARE.compiled + STEP_SHARE.frames / 2,
    )
  })

  it('the shares add up to 100%', () => {
    expect(NETWORK_SHARE + STEP_SHARE.fonts + STEP_SHARE.compiled + STEP_SHARE.frames).toBeCloseTo(1)
  })

  it('is 1 only when every gate condition holds', () => {
    expect(gateReady(READY)).toBe(true)
    expect(progressTarget(READY)).toBe(1)
    const conditions = ['assets', 'fonts', 'compiled', 'frames'] as const
    for (let mask = 0; mask < 15; mask++) {
      const partial = signals({
        network: 1,
        assets: (mask & 1) !== 0,
        fonts: (mask & 2) !== 0,
        compiled: (mask & 4) !== 0,
        frames: (mask & 8) !== 0 ? GATE_FRAMES : 1,
      })
      expect(gateReady(partial), conditions.join()).toBe(false)
      expect(progressTarget(partial)).toBeLessThanOrEqual(MAX_BEFORE_GATE)
    }
  })
})

describe('stepDisplayed (lerped, monotonic)', () => {
  it('never decreases, even when the target drops', () => {
    let displayed = 0
    const targets = [0.3, 0.5, 0.2, 0.6, 0.1, 0.0, 0.7]
    for (const target of targets) {
      for (let i = 0; i < 5; i++) {
        const next = stepDisplayed(displayed, target, 1 / 60)
        expect(next).toBeGreaterThanOrEqual(displayed)
        displayed = next
      }
    }
    expect(stepDisplayed(0.5, 0.2, 1)).toBe(0.5)
  })

  it('moves part of the way per frame and lands exactly on the target', () => {
    const first = stepDisplayed(0, 0.8, 1 / 60)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.8)
    let displayed = first
    for (let i = 0; i < 600 && displayed < 0.8; i++) displayed = stepDisplayed(displayed, 0.8, 1 / 60)
    expect(displayed).toBe(0.8)
  })

  it('does not move with a zero or negative step', () => {
    expect(stepDisplayed(0.25, 0.9, 0)).toBe(0.25)
    expect(stepDisplayed(0.25, 0.9, -1)).toBe(0.25)
  })

  it('never shows 100% before the gate, and reaches it once the gate is ready', () => {
    const timeline: BootSignals[] = [
      signals({ network: 0.2 }),
      signals({ network: 0.6, fonts: true }),
      signals({ network: 1, fonts: true }),
      signals({ network: 1, assets: true, fonts: true }),
      signals({ network: 1, assets: true, fonts: true, compiled: true }),
      signals({ network: 1, assets: true, fonts: true, compiled: true, frames: 1 }),
    ]
    let displayed = 0
    for (const state of timeline) {
      // Plenty of time per stage: the displayed value catches up with each target.
      for (let i = 0; i < 300; i++) displayed = stepDisplayed(displayed, progressTarget(state), 1 / 60)
      expect(percentOf(displayed)).toBeLessThan(100)
    }
    for (let i = 0; i < 300; i++) displayed = stepDisplayed(displayed, progressTarget(READY), 1 / 60)
    expect(displayed).toBe(1)
    expect(percentOf(displayed)).toBe(100)
  })
})

describe('percentOf', () => {
  it('floors, so 100 needs exactly 1', () => {
    expect(percentOf(0)).toBe(0)
    expect(percentOf(0.999)).toBe(99)
    expect(percentOf(1)).toBe(100)
    expect(percentOf(2)).toBe(100)
  })
})
