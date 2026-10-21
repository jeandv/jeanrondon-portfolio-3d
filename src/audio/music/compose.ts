import { between, chance, createRng, pick, type Rng } from './rng'
import { bassRoot, MAJOR_PENTATONIC, MINOR_PENTATONIC, nearest, voiceChord, type Chord, type ChordQuality } from './theory'
import { sectionOf, STEPS_PER_BAR, trackSteps, type Section, type TrackSpec } from './tracks'

/**
 * Writes one lo-fi track from its spec (pure and deterministic per seed):
 * jazzy ii–V–I-flavoured progressions on an electric piano, a soft bass with
 * chromatic approach notes, a lazy boom-bap kit (kick, a ghosted snare, swung
 * hats) and, in the B sections, a sparse pentatonic melody. Few voices: one
 * chord, one bass note, one melody note and a drum hit at a time.
 */

export type VoiceId = 'keys' | 'bass' | 'kick' | 'snare' | 'hat' | 'openhat' | 'lead'

export interface NoteEvent {
  readonly voice: VoiceId
  /** MIDI note (drums: 0). */
  readonly midi: number
  /** 0..1 */
  readonly velocity: number
  /** Length in steps (16ths; drums 1). */
  readonly length: number
  /** Humanizing delay (s, ≥ 0): rolled chords, a laid-back snare. */
  readonly nudge: number
}

export interface BarChord {
  /** Step (0–15) the chord starts on. */
  readonly step: number
  readonly chord: Chord
}

export interface Song {
  readonly spec: TrackSpec
  /** Chords of each bar (one, or two split at step 8). */
  readonly bars: readonly (readonly BarChord[])[]
  /** Events per step (bars × 16). */
  readonly steps: readonly (readonly NoteEvent[])[]
}

const ch = (root: number, quality: ChordQuality): Chord => ({ root, quality })

/** Four bars; a bar holds one chord, or two (ii–V in one bar). */
type Progression = readonly (readonly Chord[])[]

const MAJOR_A: readonly Progression[] = [
  [[ch(2, 'm9')], [ch(7, '13')], [ch(0, 'maj9')], [ch(9, 'm9')]],
  [[ch(0, 'maj9')], [ch(9, 'm9')], [ch(2, 'm9')], [ch(7, '13')]],
  [[ch(2, 'm7'), ch(7, '9')], [ch(0, 'maj9')], [ch(5, 'maj9')], [ch(4, 'm7'), ch(9, '7b9')]],
]
const MAJOR_B: readonly Progression[] = [
  [[ch(5, 'maj9')], [ch(4, 'm7')], [ch(2, 'm9')], [ch(7, '7sus')]],
  [[ch(5, 'maj9')], [ch(5, 'm9')], [ch(4, 'm7')], [ch(9, '7b9')]],
  [[ch(9, 'm9')], [ch(2, 'm9')], [ch(5, 'maj9')], [ch(7, '13')]],
]
const MINOR_A: readonly Progression[] = [
  [[ch(0, 'm9')], [ch(5, 'm9')], [ch(10, '9')], [ch(3, 'maj9')]],
  [[ch(0, 'm9')], [ch(8, 'maj9')], [ch(2, 'm7b5')], [ch(7, '7b9')]],
]
const MINOR_B: readonly Progression[] = [
  [[ch(8, 'maj9')], [ch(7, 'm7')], [ch(5, 'm9')], [ch(7, '7b9')]],
  [[ch(5, 'm9')], [ch(10, '13')], [ch(3, 'maj9')], [ch(8, 'maj9')]],
]

interface Hit {
  readonly step: number
  readonly length: number
}

/** Keys rhythms for a one-chord bar. */
const COMPS: readonly (readonly Hit[])[] = [
  [{ step: 0, length: 15 }],
  [{ step: 0, length: 7 }, { step: 10, length: 6 }],
  [{ step: 0, length: 4 }, { step: 6, length: 9 }],
  [{ step: 0, length: 11 }, { step: 14, length: 2 }],
]
const SPLIT_COMP: readonly Hit[] = [
  { step: 0, length: 7 },
  { step: 8, length: 7 },
]

/** Kick patterns: [step, velocity]. */
const KICKS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 1],
    [10, 0.8],
  ],
  [
    [0, 1],
    [7, 0.45],
    [10, 0.85],
  ],
  [
    [0, 1],
    [3, 0.5],
    [8, 0.7],
    [11, 0.55],
  ],
]
/** 8th-note hat accents (per 8th of the bar). */
const HAT_ACCENTS = [0.55, 0.3, 0.48, 0.32, 0.52, 0.3, 0.46, 0.36] as const

type BassNote = readonly [step: number, midi: number, length: number]

/** Bass rhythms for a one-chord bar (root, fifth, the chromatic approach to the next root). */
const BASS_LINES: readonly ((root: number, approach: number) => BassNote[])[] = [
  (root, approach) => [
    [0, root, 7],
    [10, root, 4],
    [14, approach, 2],
  ],
  (root) => [
    [0, root, 3],
    [6, root + 7, 2],
    [8, root, 5],
    [14, root + 12, 2],
  ],
  (root, approach) => [
    [0, root, 12],
    [14, approach, 2],
  ],
]

interface Plan {
  readonly progA: Progression
  readonly progB: Progression
  readonly tonic: Chord
  /** Pattern indices per section pass (`A0`, `B1`...). */
  readonly comp: Map<string, number>
  readonly kick: Map<string, number>
  readonly bass: Map<string, number>
}

function planOf(rng: Rng, spec: TrackSpec): Plan {
  const minor = spec.mode === 'minor'
  const plan: Plan = {
    progA: pick(rng, minor ? MINOR_A : MAJOR_A),
    progB: pick(rng, minor ? MINOR_B : MAJOR_B),
    tonic: ch(0, minor ? 'm9' : 'maj9'),
    comp: new Map(),
    kick: new Map(),
    bass: new Map(),
  }
  for (const key of ['A0', 'B0', 'A1', 'B1']) {
    plan.comp.set(key, Math.floor(rng() * COMPS.length))
    plan.kick.set(key, Math.floor(rng() * KICKS.length))
    plan.bass.set(key, Math.floor(rng() * BASS_LINES.length))
  }
  return plan
}

/** The chords of every bar (outro: the A turnaround, then the tonic held). */
function chordsOf(plan: Plan, spec: TrackSpec): BarChord[][] {
  return Array.from({ length: spec.bars }, (_, bar) => {
    const { section, barInSection } = sectionOf(bar)
    let chords: readonly Chord[]
    if (section === 'outro') chords = barInSection < 2 ? (plan.progA[barInSection] ?? [plan.tonic]) : [plan.tonic]
    else chords = (section === 'B' ? plan.progB : plan.progA)[barInSection % 4] ?? [plan.tonic]
    return chords.map((chord, i) => ({ step: i * (STEPS_PER_BAR / chords.length), chord }))
  })
}

class SongWriter {
  readonly steps: NoteEvent[][]

  constructor(total: number) {
    this.steps = Array.from({ length: total }, () => [])
  }

  add(bar: number, step: number, event: NoteEvent): void {
    this.steps[bar * STEPS_PER_BAR + step]?.push({ ...event, velocity: Math.min(1, Math.max(0.01, event.velocity)) })
  }
}

const drum = (voice: VoiceId, velocity: number, nudge = 0): NoteEvent => ({ voice, midi: 0, velocity, length: 1, nudge })

function writeKeys(rng: Rng, writer: SongWriter, bars: readonly (readonly BarChord[])[], plan: Plan, spec: TrackSpec): void {
  let previous: number[] | undefined
  bars.forEach((chords, bar) => {
    const { section, barInSection, pass } = sectionOf(bar)
    const last = bar === bars.length - 1
    const hits: readonly Hit[] =
      chords.length > 1
        ? SPLIT_COMP
        : section === 'intro' || section === 'outro'
          ? [{ step: 0, length: last ? 16 : 15 }]
          : (COMPS[plan.comp.get(`${section}${pass}`) ?? 0] ?? [{ step: 0, length: 15 }])
    const level = section === 'intro' ? 0.5 : section === 'outro' ? 0.56 - barInSection * 0.04 : section === 'B' ? 0.58 : 0.62
    for (const hit of hits) {
      const chord = [...chords].reverse().find((entry) => entry.step <= hit.step)?.chord ?? plan.tonic
      const notes = voiceChord(chord, spec.key, previous)
      previous = notes
      const velocity = level * between(rng, 0.88, 1.08) * (hit.step === 0 ? 1 : 0.85)
      // Rolled upward, a hair apart, like a lazy hand.
      notes.forEach((midi, i) => {
        writer.add(bar, hit.step, { voice: 'keys', midi, velocity, length: hit.length, nudge: i * 0.014 + rng() * 0.006 })
      })
    }
  })
}

function approachTo(rng: Rng, next: number, current: number): number {
  if (next === current) return current + 7
  return next + (chance(rng, 0.5) ? -1 : 1)
}

function writeBass(rng: Rng, writer: SongWriter, bars: readonly (readonly BarChord[])[], plan: Plan, spec: TrackSpec): void {
  bars.forEach((chords, bar) => {
    const { section, barInSection, pass } = sectionOf(bar)
    if (section === 'intro') return
    const first = chords[0]?.chord ?? plan.tonic
    const root = bassRoot(first, spec.key)
    const nextChord = bars[bar + 1]?.[0]?.chord ?? plan.tonic
    const approach = approachTo(rng, bassRoot(nextChord, spec.key), root)
    let line: BassNote[]
    if (section === 'outro') {
      line = barInSection < 2 ? [[0, root, 12], [14, approach, 2]] : [[0, root, barInSection === 3 ? 14 : 16]]
    } else if (chords.length > 1) {
      const second = bassRoot(chords[1]?.chord ?? first, spec.key)
      line = [
        [0, root, 7],
        [8, second, 5],
        [14, approach, 2],
      ]
    } else {
      line = (BASS_LINES[plan.bass.get(`${section}${pass}`) ?? 0] ?? BASS_LINES[0] ?? (() => []))(root, approach)
    }
    for (const [step, midi, length] of line) {
      const velocity = (step === 0 ? 0.85 : 0.62) * between(rng, 0.9, 1.05)
      writer.add(bar, step, { voice: 'bass', midi, velocity, length, nudge: 0 })
    }
  })
}

function writeHats(rng: Rng, writer: SongWriter, bar: number, scale: number, busy: number, open: boolean): void {
  HAT_ACCENTS.forEach((accent, eighth) => {
    const step = eighth * 2
    if (open && step === 14) writer.add(bar, step, drum('openhat', 0.5 * scale))
    else writer.add(bar, step, drum('hat', accent * scale * between(rng, 0.85, 1.1), rng() * 0.006))
  })
  if (chance(rng, busy)) writer.add(bar, pick(rng, [7, 15, 3]), drum('hat', 0.2 * scale, rng() * 0.006))
}

function writeDrums(rng: Rng, writer: SongWriter, bars: number, plan: Plan): void {
  for (let bar = 0; bar < bars; bar++) {
    const { section, barInSection, pass } = sectionOf(bar)
    if (section === 'intro') {
      // Hats creep in for the last two bars, a kick on the last downbeat.
      if (barInSection >= 2) writeHats(rng, writer, bar, 0.55, 0, false)
      if (barInSection === 3) writer.add(bar, 0, drum('kick', 0.7))
      continue
    }
    if (section === 'outro') {
      if (barInSection === 0) writeHats(rng, writer, bar, 0.6, 0, false)
      if (barInSection <= 1) writer.add(bar, 0, drum('kick', 0.75 - barInSection * 0.2))
      continue
    }
    const phraseEnd = barInSection === 7
    const kick = KICKS[plan.kick.get(`${section}${pass}`) ?? 0] ?? KICKS[0] ?? []
    for (const [step, velocity] of kick) writer.add(bar, step, drum('kick', velocity * between(rng, 0.92, 1.04)))
    if (barInSection % 4 === 3 && !phraseEnd) writer.add(bar, 14, drum('kick', 0.5))
    // Backbeat, laid back a little, with the odd ghost note.
    writer.add(bar, 4, drum('snare', 0.85 * between(rng, 0.92, 1.05), 0.012))
    writer.add(bar, 12, drum('snare', 0.9 * between(rng, 0.92, 1.05), 0.012))
    if (chance(rng, 0.4)) writer.add(bar, pick(rng, [7, 9, 15]), drum('snare', 0.2, 0.008))
    if (phraseEnd) {
      writer.add(bar, 13, drum('snare', 0.3, 0.008))
      writer.add(bar, 14, drum('snare', 0.4, 0.008))
      writer.add(bar, 15, drum('snare', 0.55, 0.008))
    }
    writeHats(rng, writer, bar, 1, section === 'B' ? 0.5 : 0.3, phraseEnd)
  }
}

/** A sparse pentatonic melody: a 4-bar call, then its answer (same rhythm, resolving home). */
function writeLead(rng: Rng, writer: SongWriter, bars: number, spec: TrackSpec): void {
  const scale = spec.mode === 'minor' ? MINOR_PENTATONIC : MAJOR_PENTATONIC
  const base = nearest(spec.key, 72)
  const note = (index: number) => base + (scale[((index % 5) + 5) % 5] ?? 0) + 12 * Math.floor(index / 5)
  const slots = [0, 3, 6, 8, 10, 12, 14]
  let start = 0
  while (start < bars) {
    const { section, barInSection } = sectionOf(start)
    if (section !== 'B' || barInSection !== 0) {
      start++
      continue
    }
    // The call: rhythm + scale degrees over 4 bars.
    const call: { bar: number; step: number; index: number }[] = []
    let index = 4 + Math.floor(rng() * 3)
    for (let bar = 0; bar < 4; bar++) {
      for (const step of slots) {
        const lastSlot = bar === 3 && step >= 8
        if (lastSlot || !chance(rng, bar === 0 && step === 0 ? 0.85 : 0.3)) continue
        index = Math.min(9, Math.max(0, index + pick(rng, [-2, -1, -1, 1, 1, 2])))
        call.push({ bar, step, index })
      }
    }
    call.push({ bar: 3, step: 8, index: pick(rng, [2, 4, 5]) })
    const phrase = (offset: number, answer: boolean) => {
      call.forEach((event, i) => {
        const next = call[i + 1]
        const at = event.bar * STEPS_PER_BAR + event.step
        const until = next ? next.bar * STEPS_PER_BAR + next.step : 4 * STEPS_PER_BAR
        const finalNote = i === call.length - 1
        const index = answer ? (finalNote ? 5 : Math.min(9, Math.max(0, event.index + (i % 3 === 1 ? 1 : 0)))) : event.index
        const length = finalNote ? 7 : Math.max(2, Math.min(6, until - at))
        writer.add(start + offset + event.bar, event.step, {
          voice: 'lead',
          midi: note(index),
          velocity: between(rng, 0.5, 0.68),
          length,
          nudge: rng() * 0.01,
        })
      })
    }
    phrase(0, false)
    phrase(4, true)
    start += 8
  }
}

/** The whole song (pure: the same spec always gives the same events). */
export function composeTrack(spec: TrackSpec): Song {
  const rng = createRng(spec.seed)
  const plan = planOf(rng, spec)
  const bars = chordsOf(plan, spec)
  const writer = new SongWriter(trackSteps(spec))
  writeKeys(rng, writer, bars, plan, spec)
  writeBass(rng, writer, bars, plan, spec)
  writeDrums(rng, writer, spec.bars, plan)
  writeLead(rng, writer, spec.bars, spec)
  return { spec, bars, steps: writer.steps }
}

/** Sections in play order with their first bar (for the LCD, tests and docs). */
export function sectionStarts(spec: TrackSpec): { section: Section; bar: number }[] {
  const starts: { section: Section; bar: number }[] = []
  for (let bar = 0; bar < spec.bars; bar++) {
    const { section, barInSection } = sectionOf(bar)
    if (barInSection === 0) starts.push({ section, bar })
  }
  return starts
}
