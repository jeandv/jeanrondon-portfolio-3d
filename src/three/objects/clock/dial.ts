import { stepSpring, type SpringParams, type SpringState } from '../motion'

/**
 * Wall clock hand math (pure). Times are "local seconds": epoch seconds
 * shifted by the visitor's time-zone offset, so the dial shows their wall
 * time and the value never wraps at midnight. Angles are clockwise from 12
 * (radians); the hands turn by −angle about their local +Z.
 */

export const TAU = Math.PI * 2
const MINUTE = 60
const HOUR = 3600
const HALF_DAY = 12 * HOUR

/** ?capture: 10:09:30, the classic "smiling" watch-ad time. */
export const CAPTURE_LOCAL_TIME = 10 * HOUR + 9 * MINUTE + 30

/** Second hand: a stiff, slightly under-damped spring (≈10% overshoot, settles in ~0.25 s). */
export const TICK_SPRING: SpringParams = { k: 700, c: 30 }

/** Catch-up sweep (s) after the battery goes back in. */
export const SWEEP_SECONDS = 0.9

export interface HandAngles {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const wrap = (value: number, period: number) => ((value % period) + period) % period

/** Local wall time (s) of an epoch time; `offsetMinutes` as Date#getTimezoneOffset (UTC − local). */
export function localSeconds(epochMs: number, offsetMinutes = new Date(epochMs).getTimezoneOffset()): number {
  return epochMs / 1000 - offsetMinutes * 60
}

/** Hour and minute hands sweep smoothly; the second hand sits on whole seconds. */
export function handAngles(local: number): HandAngles {
  return {
    hour: (wrap(local, HALF_DAY) / HALF_DAY) * TAU,
    minute: (wrap(local, HOUR) / HOUR) * TAU,
    second: (wrap(Math.floor(local), MINUTE) / MINUTE) * TAU,
  }
}

/** Clockwise turn (rad, [0, 2π)) from angle `from` to angle `to`. */
export function forwardTurn(from: number, to: number): number {
  return wrap(to - from, TAU)
}

/** Battery back in: how far each hand sweeps clockwise from the stopped time to `target` (never backward). */
export function catchUpTurns(stopped: number, target: number): HandAngles {
  const a = handAngles(stopped)
  const b = handAngles(target)
  return {
    hour: forwardTurn(a.hour, b.hour),
    minute: forwardTurn(a.minute, b.minute),
    second: forwardTurn(a.second, b.second),
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

interface Sweep {
  readonly start: number
  readonly from: HandAngles
  readonly turns: HandAngles
}

/**
 * The displayed dial over time: running (second hand ticking on a spring),
 * stopped (frozen on the stop time), or sweeping forward to catch up.
 */
export class ClockDial {
  private running = true
  private stoppedAt = 0
  private sweep: Sweep | null = null
  private tick: SpringState = { x: 0, v: 0 }
  private lastSecond = Number.NaN
  private ticked = false

  constructor(local: number) {
    this.tick = { x: Math.floor(local), v: 0 }
    this.lastSecond = Math.floor(local)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** True when the last `update` moved the second hand on to a new second (tick sound). */
  get justTicked(): boolean {
    return this.ticked
  }

  /** Battery out at `local`: the hands freeze there. */
  stop(local: number): void {
    this.running = false
    this.sweep = null
    this.stoppedAt = local
  }

  /** Battery back at `local`: sweep forward to the live time (instantly with `instant`). */
  start(local: number, instant = false): void {
    if (this.running) return
    this.running = true
    this.sweep = instant
      ? null
      : {
          start: local,
          from: handAngles(this.stoppedAt),
          turns: catchUpTurns(this.stoppedAt, local + SWEEP_SECONDS),
        }
    this.tick = { x: Math.floor(local), v: 0 }
    this.lastSecond = Math.floor(local)
  }

  /** Angles to show at `local`; `snap` (reduced motion) skips the tick spring. */
  update(local: number, dt: number, snap = false): HandAngles {
    this.ticked = false
    if (!this.running) return handAngles(this.stoppedAt)

    const sweep = this.sweep
    if (sweep) {
      const p = Math.min(1, Math.max(0, (local - sweep.start) / SWEEP_SECONDS))
      if (p < 1) {
        const e = easeInOutCubic(p)
        return {
          hour: sweep.from.hour + sweep.turns.hour * e,
          minute: sweep.from.minute + sweep.turns.minute * e,
          second: sweep.from.second + sweep.turns.second * e,
        }
      }
      this.sweep = null
      this.tick = { x: Math.floor(local), v: 0 }
      this.lastSecond = Math.floor(local)
    }

    const second = Math.floor(local)
    if (second !== this.lastSecond) {
      this.ticked = true
      this.lastSecond = second
    }
    // A jump (hidden tab, clock change): land on the second without spinning.
    if (snap || Math.abs(second - this.tick.x) > 2) this.tick = { x: second, v: 0 }
    else this.tick = stepSpring(this.tick, second, TICK_SPRING, dt)

    const live = handAngles(local)
    return { hour: live.hour, minute: live.minute, second: (wrap(this.tick.x, MINUTE) / MINUTE) * TAU }
  }
}
