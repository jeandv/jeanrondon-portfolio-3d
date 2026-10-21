import { describe, expect, it } from 'vitest'
import { BATTERY_IN, toggleBattery } from './battery'
import {
  CAPTURE_LOCAL_TIME,
  catchUpTurns,
  ClockDial,
  forwardTurn,
  handAngles,
  localSeconds,
  SWEEP_SECONDS,
  TAU,
} from './dial'

const FRAME = 1 / 60
const at = (h: number, m: number, s: number) => h * 3600 + m * 60 + s

describe('clock hand angles', () => {
  it('shows 10:09:30 in ?capture', () => {
    expect(CAPTURE_LOCAL_TIME).toBe(at(10, 9, 30))
    const angles = handAngles(CAPTURE_LOCAL_TIME)
    expect(angles.hour).toBeCloseTo(((10 + 9.5 / 60) / 12) * TAU)
    expect(angles.minute).toBeCloseTo((9.5 / 60) * TAU)
    expect(angles.second).toBeCloseTo(Math.PI)
  })

  it('wraps at 12 hours, sweeps hour/minute and ticks the second hand', () => {
    expect(handAngles(at(15, 0, 0)).hour).toBeCloseTo(handAngles(at(3, 0, 0)).hour)
    expect(handAngles(at(0, 0, 0))).toEqual({ hour: 0, minute: 0, second: 0 })
    // 0.6 s later: the second hand has not moved, the minute hand has (a little).
    expect(handAngles(at(1, 2, 3.6)).second).toBeCloseTo(handAngles(at(1, 2, 3)).second)
    expect(handAngles(at(1, 2, 3.6)).minute).toBeGreaterThan(handAngles(at(1, 2, 3)).minute)
  })

  it('reads the local time of an epoch instant', () => {
    const epoch = Date.UTC(2026, 9, 16, 12, 0, 0)
    // UTC−3 (getTimezoneOffset = +180): 09:00 local.
    const local = localSeconds(epoch, 180)
    expect(handAngles(local).hour).toBeCloseTo(handAngles(at(9, 0, 0)).hour)
    expect(localSeconds(epoch, 0) - local).toBe(3 * 3600)
  })

  it('catch-up turns go clockwise only, within one turn per hand', () => {
    expect(forwardTurn(TAU - 0.1, 0.1)).toBeCloseTo(0.2)
    expect(forwardTurn(1, 1)).toBe(0)
    const turns = catchUpTurns(at(10, 0, 0), at(10, 5, 30))
    expect(turns.second).toBeCloseTo(Math.PI)
    expect(turns.minute).toBeCloseTo((5.5 / 60) * TAU)
    expect(turns.hour).toBeCloseTo((5.5 / 720) * TAU)
    // Stopped for 13 h: the hour hand only goes one hour around, never backward.
    const long = catchUpTurns(at(1, 0, 0), at(14, 0, 0))
    expect(long.hour).toBeCloseTo(TAU / 12)
    for (const value of Object.values(long)) expect(value).toBeGreaterThanOrEqual(0)
  })
})

describe('clock dial', () => {
  it('ticks once per second with a small overshoot, then settles', () => {
    const start = at(8, 0, 0.5)
    const dial = new ClockDial(start)
    const target = (1 / 60) * TAU
    let ticks = 0
    let peak = 0
    let t = start
    for (let i = 0; i < 60; i++) {
      t += FRAME
      const { second } = dial.update(t, FRAME)
      if (dial.justTicked) ticks++
      peak = Math.max(peak, second)
    }
    expect(ticks).toBe(1)
    expect(peak).toBeGreaterThan(target)
    expect(peak).toBeLessThan(target * 1.2)
    expect(dial.update(t + FRAME, FRAME).second).toBeCloseTo(target, 3)
  })

  it('snaps with reduced motion and after a jump (no spinning)', () => {
    const dial = new ClockDial(at(8, 0, 0))
    expect(dial.update(at(8, 0, 1.01), FRAME, true).second).toBeCloseTo((1 / 60) * TAU)
    expect(dial.update(at(9, 30, 20.01), FRAME).second).toBeCloseTo((20 / 60) * TAU)
  })

  it('stops on the battery-out time and sweeps forward to the live time when it goes back', () => {
    const dial = new ClockDial(at(8, 0, 0))
    const stoppedAt = at(8, 0, 10.2)
    dial.stop(stoppedAt)
    expect(dial.isRunning).toBe(false)
    const frozen = dial.update(at(8, 2, 0), FRAME)
    expect(frozen).toEqual(handAngles(stoppedAt))
    expect(dial.justTicked).toBe(false)

    const back = at(8, 3, 40)
    dial.start(back)
    expect(dial.isRunning).toBe(true)
    const early = dial.update(back + 0.05, FRAME)
    expect(early.second).toBeGreaterThanOrEqual(handAngles(stoppedAt).second)
    expect(early.second).toBeLessThan(handAngles(back).second)
    const halfway = dial.update(back + SWEEP_SECONDS / 2, FRAME)
    expect(halfway.minute).toBeGreaterThan(frozen.minute)
    // At the end of the sweep the hands show the live time (mod a turn).
    const end = back + SWEEP_SECONDS + 0.001
    const landed = dial.update(end, FRAME)
    const live = handAngles(end)
    expect(forwardTurn(live.minute, landed.minute) % TAU).toBeCloseTo(0, 4)
    expect(Math.min(forwardTurn(live.second, landed.second), forwardTurn(landed.second, live.second))).toBeLessThan(0.02)
  })

  it('reduced motion puts the battery back without a sweep', () => {
    const dial = new ClockDial(at(8, 0, 0))
    dial.stop(at(8, 0, 0))
    dial.start(at(9, 15, 0), true)
    expect(dial.update(at(9, 15, 0.01), FRAME, true)).toEqual(handAngles(at(9, 15, 0.01)))
  })

  it('the battery toggles out (remembering when) and back in', () => {
    const out = toggleBattery(BATTERY_IN, 1234)
    expect(out).toEqual({ running: false, stoppedAt: 1234 })
    expect(toggleBattery(out, 5678)).toBe(BATTERY_IN)
  })
})
