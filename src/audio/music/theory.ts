/** Just enough harmony for lo-fi comping: jazzy seventh chords, close voicings, a bass note. */

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export type ChordQuality = 'maj7' | 'maj9' | 'm7' | 'm9' | 'm7b5' | '7' | '9' | '13' | '7sus' | '7b9'

/**
 * The four tones the keys play above the chord root (semitones). Ninth and
 * thirteenth chords drop the root (the bass has it): "rootless" voicings.
 */
export const QUALITY_TONES: Readonly<Record<ChordQuality, readonly number[]>> = {
  maj7: [0, 4, 7, 11],
  maj9: [4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [3, 7, 10, 14],
  m7b5: [0, 3, 6, 10],
  '7': [0, 4, 7, 10],
  '9': [4, 7, 10, 14],
  '13': [4, 10, 14, 21],
  '7sus': [5, 7, 10, 14],
  '7b9': [4, 7, 10, 13],
}

export interface Chord {
  /** Root in semitones above the key's tonic. */
  readonly root: number
  readonly quality: ChordQuality
}

/** Centre (MIDI) the keys voicings gather around: around D4–E4, warm and out of the bass's way. */
export const VOICING_CENTER = 63
/** The voicing centre follows the previous chord, within this range (smooth voice leading). */
export const VOICING_RANGE = [59, 67] as const
/** The bass plays the root nearest to this (E2), never below C2. */
export const BASS_CENTER = 40
export const BASS_LOWEST = 36

const pitchClass = (n: number) => ((n % 12) + 12) % 12

/** The octave of pitch class `pc` nearest to `center`. */
export function nearest(pc: number, center: number): number {
  const base = center - pitchClass(center) + pitchClass(pc)
  const candidates = [base - 12, base, base + 12]
  return candidates.reduce((best, n) => (Math.abs(n - center) < Math.abs(best - center) ? n : best))
}

/**
 * Close voicing of a chord in a key (tonic pitch class): every tone in the
 * octave nearest the centre, which tracks the previous voicing's average.
 * Sorted, unique MIDI notes.
 */
export function voiceChord(chord: Chord, tonic: number, previous?: readonly number[]): number[] {
  const average = previous && previous.length > 0 ? previous.reduce((sum, n) => sum + n, 0) / previous.length : VOICING_CENTER
  const center = Math.round(Math.min(VOICING_RANGE[1], Math.max(VOICING_RANGE[0], average)))
  const notes = QUALITY_TONES[chord.quality].map((interval) => nearest(tonic + chord.root + interval, center))
  return [...new Set(notes)].sort((a, b) => a - b)
}

/** The chord's root for the bass. */
export function bassRoot(chord: Chord, tonic: number): number {
  const note = nearest(tonic + chord.root, BASS_CENTER)
  return note < BASS_LOWEST ? note + 12 : note
}

export const MAJOR_PENTATONIC = [0, 2, 4, 7, 9] as const
export const MINOR_PENTATONIC = [0, 3, 5, 7, 10] as const
