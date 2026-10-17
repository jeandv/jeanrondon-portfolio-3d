/**
 * The CD player's state (pure, three-free: the store, the LCD, the music
 * engine and the tests share it). Times are seconds on the music clock
 * (src/audio/music/clock.ts: the AudioContext's, so a hidden tab freezes the
 * disc with the sound). The disc repeats: after the last track comes the first.
 */

export type CdStatus = 'stopped' | 'playing' | 'paused'
export type CdLid = 'open' | 'closed'

export interface CdState {
  readonly lid: CdLid
  readonly status: CdStatus
  /** Track index (0-based) at `since` (playing) or now (paused / stopped). */
  readonly track: number
  /** Seconds into `track`: frozen when paused, measured at `since` when playing. */
  readonly position: number
  /** Clock time (s) `position` was taken at while playing; null otherwise. */
  readonly since: number | null
}

export type CdAction = 'play' | 'pause' | 'toggle' | 'stop' | 'next' | 'prev' | 'lid'

export const CD_STOPPED: CdState = { lid: 'closed', status: 'stopped', track: 0, position: 0, since: null }

/** `prev` within this many seconds of a track's start goes to the previous track, later it restarts the track. */
export const PREV_RESTART_SECONDS = 3

export interface CdCursor {
  readonly track: number
  /** Seconds into the track (negative during a pre-roll). */
  readonly position: number
}

const wrap = (index: number, count: number) => ((index % count) + count) % count

/** Track and position on the disc at `now` (`lengths`: seconds per track; wraps past the last track). */
export function cursorAt(state: CdState, lengths: readonly number[], now: number): CdCursor {
  const count = lengths.length
  if (count === 0) return { track: 0, position: 0 }
  let track = wrap(state.track, count)
  let position = state.status === 'playing' && state.since !== null ? state.position + (now - state.since) : state.position
  // Bounded walk (a hidden tab can only add so much time; past ~one disc it wraps by modulo).
  const disc = lengths.reduce((sum, length) => sum + length, 0)
  if (disc > 0 && position > disc * 2) position %= disc
  for (let guard = 0; guard < count * 3; guard++) {
    const length = lengths[track] ?? 0
    if (length <= 0 || position < length) break
    position -= length
    track = wrap(track + 1, count)
  }
  return { track, position }
}

/** Seconds into the current track at `now` (never negative). */
export function elapsed(state: CdState, lengths: readonly number[], now: number): number {
  return Math.max(0, cursorAt(state, lengths, now).position)
}

/**
 * Rebases a playing state once its track has rolled over (the LCD and the
 * store follow the disc); the same object while nothing changed.
 */
export function settle(state: CdState, lengths: readonly number[], now: number): CdState {
  if (state.status !== 'playing') return state
  const cursor = cursorAt(state, lengths, now)
  return cursor.track === state.track ? state : { ...state, track: cursor.track, position: cursor.position, since: now }
}

/** Same audible cursor (status, track and position within `epsilon` s): the music need not re-sync. */
export function sameCursor(a: CdState, b: CdState, lengths: readonly number[], now: number, epsilon = 0.02): boolean {
  if (a.status !== b.status) return false
  const ca = cursorAt(a, lengths, now)
  const cb = cursorAt(b, lengths, now)
  return ca.track === cb.track && Math.abs(ca.position - cb.position) < epsilon
}

function play(state: CdState, lengths: readonly number[], now: number): CdState {
  // Play shuts the lid (and spins up).
  if (state.status === 'playing') return state.lid === 'closed' ? state : { ...state, lid: 'closed' }
  const position = state.status === 'paused' ? state.position : 0
  return { lid: 'closed', status: 'playing', track: wrap(state.track, lengths.length || 1), position, since: now }
}

function pause(state: CdState, lengths: readonly number[], now: number): CdState {
  if (state.status !== 'playing') return state
  const cursor = cursorAt(state, lengths, now)
  return { ...state, status: 'paused', track: cursor.track, position: Math.max(0, cursor.position), since: null }
}

/** Moves to `track` at 0:00, keeping the status (playing restarts the clock there). */
function jump(state: CdState, track: number, count: number, now: number): CdState {
  const next = wrap(track, count)
  return { ...state, track: next, position: 0, since: state.status === 'playing' ? now : null }
}

/** The player after a button press (pure). */
export function cdPress(state: CdState, action: CdAction, lengths: readonly number[], now: number): CdState {
  const count = lengths.length || 1
  switch (action) {
    case 'play':
      return play(state, lengths, now)
    case 'pause':
      return pause(state, lengths, now)
    case 'toggle':
      return state.status === 'playing' ? pause(state, lengths, now) : play(state, lengths, now)
    case 'stop':
      return state.status === 'stopped' ? state : { ...state, status: 'stopped', position: 0, since: null }
    case 'next':
      return jump(state, cursorAt(state, lengths, now).track + 1, count, now)
    case 'prev': {
      const cursor = cursorAt(state, lengths, now)
      const restart = state.status !== 'stopped' && cursor.position > PREV_RESTART_SECONDS
      return jump(state, restart ? cursor.track : cursor.track - 1, count, now)
    }
    case 'lid':
      // Opening the lid stops the disc, like a real player; closing it leaves it stopped.
      return state.lid === 'open'
        ? { ...state, lid: 'closed' }
        : { ...state, lid: 'open', status: 'stopped', position: 0, since: null }
  }
}

/** Shuts the lid (leaving the close-up), keeping whatever plays. */
export function closeLid(state: CdState): CdState {
  return state.lid === 'closed' ? state : { ...state, lid: 'closed' }
}

/** Selects track `index` and plays it from 0:00. */
export function playTrack(state: CdState, index: number, lengths: readonly number[], now: number): CdState {
  const count = lengths.length || 1
  return { lid: 'closed', status: 'playing', track: wrap(index, count), position: 0, since: now }
}
