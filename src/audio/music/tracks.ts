/**
 * The three generated tracks on the CD (titles: src/content/music.ts). Each
 * is a seeded piece (compose.ts): the seed picks the progressions, the comping,
 * the drum feel, the bass and the melody; key, tempo and swing set the mood.
 */

export interface TrackSpec {
  readonly seed: number
  readonly bpm: number
  /** Tonic pitch class (C = 0). */
  readonly key: number
  readonly mode: 'major' | 'minor'
  /** How late the off-beat 16ths come (share of a 16th). */
  readonly swing: number
  readonly bars: number
}

export const STEPS_PER_BAR = 16

export const TRACKS: readonly TrackSpec[] = [
  { seed: 1907, bpm: 74, key: 5, mode: 'major', swing: 0.16, bars: 40 },
  { seed: 2412, bpm: 82, key: 2, mode: 'minor', swing: 0.2, bars: 40 },
  { seed: 3301, bpm: 70, key: 3, mode: 'major', swing: 0.12, bars: 40 },
]

/** One 16th note (s). */
export function stepSeconds(spec: TrackSpec): number {
  return 60 / spec.bpm / 4
}

export function trackSteps(spec: TrackSpec): number {
  return spec.bars * STEPS_PER_BAR
}

/** Track length (s); the transport and the CD player both use exactly this. */
export function trackSeconds(spec: TrackSpec): number {
  return trackSteps(spec) * stepSeconds(spec)
}

/** Seconds per track, in disc order. */
export const TRACK_SECONDS: readonly number[] = TRACKS.map(trackSeconds)

/** Swing: the off-beat 16ths come `swing` of a step late. */
export function swingDelay(spec: TrackSpec, step: number): number {
  return step % 2 === 1 ? spec.swing * stepSeconds(spec) : 0
}

export type Section = 'intro' | 'A' | 'B' | 'outro'

/** Form of every track (bars): intro 4, A 8, B 8, A 8, B 8, outro 4. */
export const FORM: readonly (readonly [Section, number])[] = [
  ['intro', 4],
  ['A', 8],
  ['B', 8],
  ['A', 8],
  ['B', 8],
  ['outro', 4],
]

/** The section a bar is in, its bar within it and which time through (A and B come twice). */
export function sectionOf(bar: number): { section: Section; barInSection: number; pass: number } {
  let start = 0
  const seen: Partial<Record<Section, number>> = {}
  for (const [section, length] of FORM) {
    const pass = seen[section] ?? 0
    seen[section] = pass + 1
    if (bar < start + length) return { section, barInSection: bar - start, pass }
    start += length
  }
  return { section: 'outro', barInSection: Math.max(0, bar - (start - 4)), pass: 0 }
}
