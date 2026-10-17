/**
 * Look-ahead scheduler ("A Tale of Two Clocks", C. Wilson): a coarse JS
 * timer (~25 ms) wakes up and books every note due before `now + lookahead`
 * on the precise audio clock. Windows are contiguous and half-open, so no
 * note is booked twice; a late wake-up (throttled tab) skips what is already
 * past instead of playing it all at once. Stopped: no timer, no work.
 */

export interface IntervalTimers {
  every(callback: () => void, ms: number): number
  cancel(id: number): void
}

export const BROWSER_INTERVALS: IntervalTimers = {
  every: (callback, ms) => window.setInterval(callback, ms),
  cancel: (id) => window.clearInterval(id),
}

/** How far ahead (s) notes are booked, and how often (ms) the timer wakes up. */
export const LOOKAHEAD_SECONDS = 0.12
export const WAKE_MS = 25

export interface SchedulerOptions {
  /** The audio clock (s). */
  readonly now: () => number
  readonly timers: IntervalTimers
  /** Books everything with a grid time in [from, to). */
  readonly onWindow: (from: number, to: number) => void
  readonly lookahead?: number
  readonly interval?: number
}

export class LookaheadScheduler {
  private readonly options: SchedulerOptions
  private timer: number | null = null
  private until = 0

  constructor(options: SchedulerOptions) {
    this.options = options
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Everything before this (s) has been booked. */
  get scheduledUntil(): number {
    return this.until
  }

  /** Starts booking from `at` (default: now) and keeps waking up. */
  start(at = this.options.now()): void {
    this.until = at
    if (this.timer === null) {
      this.timer = this.options.timers.every(() => this.tick(), this.options.interval ?? WAKE_MS)
    }
    this.tick()
  }

  /** Stops waking up (nothing more is booked). */
  stop(): void {
    if (this.timer !== null) this.options.timers.cancel(this.timer)
    this.timer = null
  }

  /** One wake-up: books [max(booked, now), now + lookahead). */
  tick(): void {
    if (this.timer === null) return
    const now = this.options.now()
    const horizon = now + (this.options.lookahead ?? LOOKAHEAD_SECONDS)
    if (horizon <= this.until) return
    const from = Math.max(this.until, now)
    this.until = horizon
    this.options.onWindow(from, horizon)
  }
}
