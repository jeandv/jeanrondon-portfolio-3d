import { describe, expect, it } from 'vitest'
import { CD_STOPPED, cdPress, closeLid, cursorAt, elapsed, playTrack, PREV_RESTART_SECONDS, sameCursor, settle, type CdState } from './player'

/** Three tracks of 100, 50 and 80 s. */
const LENGTHS = [100, 50, 80]
const press = (state: CdState, action: Parameters<typeof cdPress>[1], now: number) => cdPress(state, action, LENGTHS, now)

describe('CD player: transport', () => {
  it('starts closed and stopped at track 1, 0:00', () => {
    expect(CD_STOPPED).toEqual({ lid: 'closed', status: 'stopped', track: 0, position: 0, since: null })
    expect(elapsed(CD_STOPPED, LENGTHS, 999)).toBe(0)
  })

  it('play runs the clock from 0:00; pause freezes it; play resumes', () => {
    const playing = press(CD_STOPPED, 'play', 10)
    expect(playing).toMatchObject({ status: 'playing', track: 0, position: 0, since: 10 })
    expect(elapsed(playing, LENGTHS, 25)).toBe(15)
    const paused = press(playing, 'pause', 25)
    expect(paused).toMatchObject({ status: 'paused', track: 0, position: 15, since: null })
    expect(elapsed(paused, LENGTHS, 500)).toBe(15)
    const resumed = press(paused, 'play', 600)
    expect(resumed).toMatchObject({ status: 'playing', position: 15, since: 600 })
    expect(elapsed(resumed, LENGTHS, 605)).toBe(20)
  })

  it('toggle switches play / pause; stop rewinds the track', () => {
    const playing = press(CD_STOPPED, 'toggle', 0)
    expect(playing.status).toBe('playing')
    expect(press(playing, 'toggle', 4).status).toBe('paused')
    const stopped = press(playing, 'stop', 30)
    expect(stopped).toMatchObject({ status: 'stopped', track: 0, position: 0, since: null })
    expect(press(stopped, 'stop', 31)).toBe(stopped)
    expect(press(stopped, 'pause', 31)).toBe(stopped)
  })

  it('rolls into the next track and repeats the disc after the last one', () => {
    const playing = press(CD_STOPPED, 'play', 0)
    expect(cursorAt(playing, LENGTHS, 99)).toEqual({ track: 0, position: 99 })
    expect(cursorAt(playing, LENGTHS, 100)).toEqual({ track: 1, position: 0 })
    expect(cursorAt(playing, LENGTHS, 160)).toEqual({ track: 2, position: 10 })
    expect(cursorAt(playing, LENGTHS, 235)).toEqual({ track: 0, position: 5 })
    // A very long hidden tab wraps by whole discs.
    const far = cursorAt(playing, LENGTHS, 230 * 1000 + 42)
    expect(far).toEqual({ track: 0, position: 42 })
  })

  it('settle rebases the state once the track rolled over (same object otherwise)', () => {
    const playing = press(CD_STOPPED, 'play', 0)
    expect(settle(playing, LENGTHS, 50)).toBe(playing)
    const next = settle(playing, LENGTHS, 120)
    expect(next).toMatchObject({ status: 'playing', track: 1, position: 20, since: 120 })
    expect(sameCursor(playing, next, LENGTHS, 130)).toBe(true)
    expect(settle(press(playing, 'pause', 10), LENGTHS, 500).status).toBe('paused')
  })
})

describe('CD player: track changes', () => {
  it('next / prev move between tracks (wrapping), keeping play or pause', () => {
    const playing = press(CD_STOPPED, 'play', 0)
    const next = press(playing, 'next', 30)
    expect(next).toMatchObject({ status: 'playing', track: 1, position: 0, since: 30 })
    expect(press(press(next, 'next', 31), 'next', 32).track).toBe(0)
    const paused = press(press(CD_STOPPED, 'play', 0), 'pause', 5)
    expect(press(paused, 'next', 6)).toMatchObject({ status: 'paused', track: 1, position: 0, since: null })
    expect(press(CD_STOPPED, 'prev', 0).track).toBe(2)
  })

  it('prev restarts the track after the first seconds, else goes back one', () => {
    const playing = press(press(CD_STOPPED, 'play', 0), 'next', 0)
    const restarted = press(playing, 'prev', PREV_RESTART_SECONDS + 5)
    expect(restarted).toMatchObject({ track: 1, position: 0, since: PREV_RESTART_SECONDS + 5 })
    expect(press(restarted, 'prev', PREV_RESTART_SECONDS + 6).track).toBe(0)
  })

  it('next follows the disc after a roll-over that was not settled yet', () => {
    const playing = press(CD_STOPPED, 'play', 0)
    expect(press(playing, 'next', 120).track).toBe(2)
  })

  it('playTrack jumps straight to a track, playing', () => {
    expect(playTrack(CD_STOPPED, 2, LENGTHS, 7)).toEqual({ lid: 'closed', status: 'playing', track: 2, position: 0, since: 7 })
    expect(playTrack(CD_STOPPED, 4, LENGTHS, 7).track).toBe(1)
  })
})

describe('CD player: the lid', () => {
  it('opening the lid stops the disc; closing leaves it stopped', () => {
    const playing = press(CD_STOPPED, 'play', 0)
    const open = press(playing, 'lid', 12)
    expect(open).toMatchObject({ lid: 'open', status: 'stopped', position: 0, since: null })
    const closed = press(open, 'lid', 13)
    expect(closed).toMatchObject({ lid: 'closed', status: 'stopped' })
  })

  it('play shuts an open lid and spins up', () => {
    const open = press(CD_STOPPED, 'lid', 0)
    expect(press(open, 'play', 1)).toMatchObject({ lid: 'closed', status: 'playing', since: 1 })
  })

  it('closeLid (leaving the close-up) keeps what plays', () => {
    const open = press(CD_STOPPED, 'lid', 0)
    expect(closeLid(open).lid).toBe('closed')
    const playing = press(CD_STOPPED, 'play', 0)
    expect(closeLid(playing)).toBe(playing)
  })
})
