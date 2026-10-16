import type { Route } from '../../../state/router'

/**
 * Tape deck state machine (pure: no three, no React). Each tape has a
 * progress `s` along its insertion path, in segment units:
 *   0 ─ pull ─ 1 ─ arc ─ 2 ─ push ─ 3
 *   0 = on the shelf, 1 = slid out of the rack, 2 = in front of the VCR slot,
 *   3 = inside the VCR (hidden, playing).
 * The deck drives every tape toward its goal each frame: the target tape
 * toward 3, every other tape toward 0. Reversing mid-path is just moving the
 * other way along the same path, so any sequence of targets converges and no
 * tape is ever left mid-air.
 *
 * Collisions: only one tape may be above the shelf (s > 1) at a time. A tape
 * that wants to go in waits slid out (s ≤ GATE_S) while another one is still
 * in the air or in the VCR; the other one is on its way back (it is not the
 * target), so the wait always ends.
 */

export const SEGMENTS = 3
/** End of the pull segment: the tape is out of the rack. */
export const OFF_SHELF = 1
/** Start of the push segment: the tape is aligned in front of the slot. */
export const AT_SLOT = 2
/** How far (s) a waiting tape slides out while another one is still out. */
export const GATE_S = 0.4

export interface DeckTiming {
  /** Seconds per segment (pull, arc, push) going in. */
  readonly insert: readonly [number, number, number]
  /** Seconds per segment (settle, return arc, pop) coming out. */
  readonly eject: readonly [number, number, number]
}

/** Arc ≈ 0.7 s in (plan), a snappier eject. */
export const DECK_TIMING: DeckTiming = {
  insert: [0.3, 0.7, 0.32],
  eject: [0.25, 0.6, 0.2],
}

export type TapeMotion = 'idle' | 'inserting' | 'playing' | 'ejecting'

/** What the VCR holds, for the TV, the audio and `body[data-tape-state]`. */
export type VcrState = 'empty' | 'loading' | 'playing' | 'ejecting'

export interface VcrStatus {
  readonly tape: string | null
  readonly state: VcrState
}

export type DeckEvent =
  /** The VCR flap should swing open (a tape is about to go in or come out). */
  | { readonly type: 'flap'; readonly tape: string }
  /** A tape went all the way in (thump; the TV may switch to it). */
  | { readonly type: 'inserted'; readonly tape: string }
  /** A playing tape starts coming out (eject click). */
  | { readonly type: 'eject'; readonly tape: string }
  /** A tape is back in its rack slot. */
  | { readonly type: 'parked'; readonly tape: string }

interface Track {
  readonly id: string
  s: number
  /** Direction of the last step: 1 in, −1 out, 0 resting. */
  dir: -1 | 0 | 1
}

/** Seconds → progress along the path, segment by segment, never past `limit`. */
export function advance(s: number, dt: number, dir: 1 | -1, limit: number, durations: readonly number[]): number {
  let left = Math.max(0, dt)
  let next = s
  while (left > 0 && next !== limit) {
    const segment = dir > 0 ? Math.min(SEGMENTS - 1, Math.floor(next)) : Math.min(SEGMENTS - 1, Math.ceil(next) - 1)
    const boundary = dir > 0 ? Math.min(segment + 1, limit) : Math.max(segment, limit)
    const rate = 1 / Math.max(1e-3, durations[segment] ?? 1)
    const need = Math.abs(boundary - next) / rate
    if (need <= left) {
      next = boundary
      left -= need
    } else {
      next += dir * left * rate
      left = 0
    }
  }
  return next
}

export class TapeDeck {
  private readonly tracks: Track[]
  private readonly timing: DeckTiming
  private targetId: string | null = null

  constructor(ids: readonly string[], timing: DeckTiming = DECK_TIMING) {
    this.tracks = ids.map((id) => ({ id, s: 0, dir: 0 }))
    this.timing = timing
  }

  get target(): string | null {
    return this.targetId
  }

  /** The tape that should end up in the VCR (null: eject everything). */
  setTarget(id: string | null): void {
    this.targetId = id
  }

  has(id: string): boolean {
    return this.tracks.some((track) => track.id === id)
  }

  /** Path progress 0..3 of a tape (0 for unknown ids). */
  progress(id: string): number {
    return this.tracks.find((track) => track.id === id)?.s ?? 0
  }

  motion(id: string): TapeMotion {
    const track = this.tracks.find((candidate) => candidate.id === id)
    if (!track) return 'idle'
    if (track.s === SEGMENTS && track.dir !== -1) return 'playing'
    if (track.dir === -1) return 'ejecting'
    if (track.s > 0 || (track.dir === 1 && track.id === this.targetId)) return 'inserting'
    return 'idle'
  }

  /** True once every tape rests at its goal. */
  get settled(): boolean {
    return this.tracks.every((track) => track.s === this.goalOf(track))
  }

  /**
   * Advances every tape by `dt` seconds (`snap`: jump to the goals, e.g.
   * reduced motion or ?capture). Returns what happened this step.
   */
  update(dt: number, snap = false): DeckEvent[] {
    const events: DeckEvent[] = []
    for (const track of this.tracks) {
      const goal = this.goalOf(track)
      const from = track.s
      if (from === goal) {
        track.dir = 0
        continue
      }
      if (goal > from) {
        const limit = snap ? goal : this.othersOut(track) ? Math.max(from, Math.min(goal, GATE_S)) : goal
        const next = snap ? limit : advance(from, dt, 1, limit, this.timing.insert)
        track.dir = next > from ? 1 : track.dir === -1 ? 0 : track.dir
        track.s = next
        if (!snap && from < AT_SLOT && next >= AT_SLOT) events.push({ type: 'flap', tape: track.id })
        if (next === SEGMENTS) {
          track.dir = 0
          events.push({ type: 'inserted', tape: track.id })
        }
      } else {
        if (from === SEGMENTS) {
          events.push({ type: 'eject', tape: track.id })
          if (!snap) events.push({ type: 'flap', tape: track.id })
        }
        const next = snap ? goal : advance(from, dt, -1, goal, this.timing.eject)
        track.dir = -1
        track.s = next
        if (next === 0) {
          track.dir = 0
          events.push({ type: 'parked', tape: track.id })
        }
      }
    }
    return events
  }

  /** What the VCR holds right now. */
  status(): VcrStatus {
    const playing = this.tracks.find((track) => track.s === SEGMENTS && track.dir !== -1)
    if (playing) return { tape: playing.id, state: 'playing' }
    const leaving = this.tracks.find((track) => track.dir === -1 && track.s > OFF_SHELF)
    if (leaving) return { tape: leaving.id, state: 'ejecting' }
    const target = this.targetId
    if (target === null) return { tape: null, state: 'empty' }
    // A tape without a shelf node plays as soon as the VCR is free.
    if (!this.has(target)) return { tape: target, state: 'playing' }
    return this.progress(target) > 0 ? { tape: target, state: 'loading' } : { tape: null, state: 'empty' }
  }

  private goalOf(track: Track): number {
    return track.id === this.targetId ? SEGMENTS : 0
  }

  /** Another tape is above the shelf (in the air or in the VCR). */
  private othersOut(self: Track): boolean {
    return this.tracks.some((track) => track !== self && track.s > OFF_SHELF)
  }
}

/**
 * The tape the deck should hold. It only follows the route once live (a
 * deep-linked tape goes in after the gate), and only on #work: leaving #work
 * keeps the tape in the VCR, #work without a tape ejects it.
 */
export function deckTarget(current: string | null, phase: string, route: Route): string | null {
  if (phase !== 'live' || route.page !== 'work') return current
  return route.tape ?? null
}

export function sameStatus(a: VcrStatus, b: VcrStatus): boolean {
  return a.tape === b.tape && a.state === b.state
}
