import type { CdState } from '../../three/objects/cd/player'
import { stepSeconds, swingDelay, trackSeconds, trackSteps, type TrackSpec } from './tracks'

/**
 * Where the disc's 16th-note grid falls on the audio clock (pure). A playing
 * CD state pins the start of its track (`since − position`); the following
 * tracks start back to back (the disc repeats), so a window of time maps to a
 * list of steps, each exactly once across contiguous windows.
 */

export interface StepTick {
  readonly track: number
  /** Step index within the track (16ths from its first beat). */
  readonly step: number
  /** When it sounds (s, audio clock): the grid time plus swing. */
  readonly time: number
}

/** Upper bound on tracks walked per call (a long hidden tab cannot spin forever). */
const MAX_TRACK_WALK = 16

/**
 * Every step whose grid time lies in [from, to) (half-open: contiguous
 * windows never share a step). Nothing unless the disc is playing.
 */
export function stepsInWindow(state: CdState, tracks: readonly TrackSpec[], from: number, to: number, out: StepTick[] = []): StepTick[] {
  if (state.status !== 'playing' || state.since === null || to <= from || tracks.length === 0) return out
  let track = ((state.track % tracks.length) + tracks.length) % tracks.length
  let start = state.since - state.position
  let walked = 0
  // Forward to the track that is playing at `from`.
  for (let spec = tracks[track]; spec && start + trackSeconds(spec) <= from && walked < MAX_TRACK_WALK; spec = tracks[track]) {
    start += trackSeconds(spec)
    track = (track + 1) % tracks.length
    walked++
  }
  for (let spec = tracks[track]; spec && start < to && walked < MAX_TRACK_WALK; spec = tracks[track]) {
    const sd = stepSeconds(spec)
    const total = trackSteps(spec)
    let i = Math.max(0, Math.ceil((from - start) / sd))
    // Exact half-open membership with the same arithmetic as the emitted times.
    while (i > 0 && start + (i - 1) * sd >= from) i--
    while (i < total && start + i * sd < from) i++
    for (; i < total; i++) {
      const grid = start + i * sd
      if (grid >= to) break
      out.push({ track, step: i, time: grid + swingDelay(spec, i) })
    }
    start += trackSeconds(spec)
    track = (track + 1) % tracks.length
    walked++
  }
  return out
}
