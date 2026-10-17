/**
 * The wall clock's battery (pure, three-free: the store and the hotspot label
 * use it). Out, the clock stops and remembers when; back in, it catches up
 * with a quick sweep (dial.ts). Times are epoch milliseconds.
 */
export interface ClockBattery {
  readonly running: boolean
  /** When the battery came out (null while running). */
  readonly stoppedAt: number | null
}

export const BATTERY_IN: ClockBattery = { running: true, stoppedAt: null }

export function toggleBattery(battery: ClockBattery, now: number): ClockBattery {
  return battery.running ? { running: false, stoppedAt: now } : BATTERY_IN
}
