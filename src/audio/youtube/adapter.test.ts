import { describe, expect, it, vi } from 'vitest'
import { DISCS } from '../music/discs'
import type { SourceSnapshot } from '../music/source'
import { ERROR_SKIP_MS, mapPlayerState, YouTubeSource } from './adapter'
import { YT_HOST, YT_STATE, type YtNamespace, type YtPlayerLike, type YtPlayerOptions } from './api'

/* ------------------------------------------------------------------ */
/* A fake YT.Player and timers                                          */
/* ------------------------------------------------------------------ */

class FakePlayer implements YtPlayerLike {
  static last: FakePlayer | null = null
  readonly options: YtPlayerOptions
  readonly calls: string[] = []
  videoId: string
  time = 0
  duration = 200
  volume = 100
  muted = false
  destroyed = false

  constructor(_element: HTMLElement | string, options: YtPlayerOptions) {
    this.options = options
    this.videoId = options.videoId ?? ''
    FakePlayer.last = this
  }

  ready() {
    this.options.events?.onReady?.({ target: this })
  }
  state(data: number) {
    this.options.events?.onStateChange?.({ target: this, data })
  }
  fail(data: number) {
    this.options.events?.onError?.({ target: this, data })
  }

  playVideo() {
    this.calls.push('play')
  }
  pauseVideo() {
    this.calls.push('pause')
  }
  stopVideo() {
    this.calls.push('stop')
  }
  loadVideoById(id: string) {
    this.calls.push(`load:${id}`)
    this.videoId = id
  }
  cueVideoById(id: string) {
    this.calls.push(`cue:${id}`)
    this.videoId = id
  }
  seekTo(seconds: number) {
    this.calls.push(`seek:${seconds}`)
    this.time = seconds
  }
  getCurrentTime() {
    return this.time
  }
  getDuration() {
    return this.duration
  }
  setVolume(volume: number) {
    this.volume = volume
  }
  mute() {
    this.muted = true
  }
  unMute() {
    this.muted = false
  }
  destroy() {
    this.destroyed = true
  }
}

const FAKE_YT: YtNamespace = { Player: FakePlayer }

function fakeTimers() {
  let next = 1
  const pending = new Map<number, { at: number; callback: () => void }>()
  let now = 0
  return {
    timers: {
      set: (callback: () => void, ms: number) => {
        const id = next++
        pending.set(id, { at: now + ms, callback })
        return id
      },
      clear: (id: number) => {
        pending.delete(id)
      },
    },
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id)
          timer.callback()
        }
      }
    },
  }
}

/** A minimal DOM for the host element (vitest runs in node). */
function fakeHost(): HTMLElement {
  return { replaceChildren: vi.fn() } as unknown as HTMLElement
}

const IDS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']

async function setup(options: { volume?: number; muted?: boolean; loadApi?: () => Promise<YtNamespace> } = {}) {
  const changes: SourceSnapshot[] = []
  const clock = fakeTimers()
  vi.stubGlobal('document', { createElement: () => ({}) })
  const source = new YouTubeSource({
    disc: DISCS.joji,
    videoIds: IDS,
    loadApi: options.loadApi ?? (() => Promise.resolve(FAKE_YT)),
    timers: clock.timers,
    origin: 'http://localhost:5176',
    onChange: (snapshot) => changes.push(snapshot),
    volume: options.volume ?? 70,
    muted: options.muted ?? false,
  })
  return { source, changes, clock }
}

/** PLAY, the monitor mounts, the API loads, the player is ready. */
async function playing(options: Parameters<typeof setup>[0] = {}) {
  const context = await setup(options)
  FakePlayer.last = null
  context.source.press('toggle')
  context.source.attach(fakeHost())
  await Promise.resolve()
  await Promise.resolve()
  const player = FakePlayer.last as FakePlayer | null
  if (!player) throw new Error('no player built')
  player.ready()
  player.state(YT_STATE.playing)
  return { ...context, player }
}

describe('YouTube adapter: state mapping', () => {
  it('maps YT.PlayerState onto the CD player statuses', () => {
    expect(mapPlayerState(YT_STATE.playing, 'loading')).toBe('playing')
    expect(mapPlayerState(YT_STATE.paused, 'playing')).toBe('paused')
    expect(mapPlayerState(YT_STATE.buffering, 'playing')).toBe('playing')
    expect(mapPlayerState(YT_STATE.buffering, 'loading')).toBe('loading')
    expect(mapPlayerState(YT_STATE.cued, 'paused')).toBe('paused')
    expect(mapPlayerState(YT_STATE.unstarted, 'stopped')).toBe('stopped')
    expect(mapPlayerState(YT_STATE.unstarted, 'playing')).toBe('loading')
  })
})

describe('YouTube adapter: lifecycle', () => {
  it('asks for the monitor on PLAY, builds the player there (nocookie host, no controls) and plays once ready', async () => {
    const { source, changes } = await setup()
    expect(source.snapshot().status).toBe('stopped')
    source.press('toggle')
    expect(changes.at(-1)?.status).toBe('loading')
    // Nothing is built before the monitor's host exists.
    FakePlayer.last = null
    await Promise.resolve()
    expect(FakePlayer.last).toBeNull()
    source.attach(fakeHost())
    await Promise.resolve()
    await Promise.resolve()
    const player = FakePlayer.last as FakePlayer | null
    expect(player?.options.host).toBe(YT_HOST)
    expect(player?.options.videoId).toBe(IDS[0])
    expect(player?.options.playerVars).toMatchObject({ controls: 0, playsinline: 1, rel: 0, origin: 'http://localhost:5176' })
    expect(player?.options.playerVars).not.toHaveProperty('modestbranding')
    player?.ready()
    expect(player?.calls).toContain('play')
    player?.state(YT_STATE.playing)
    expect(source.snapshot()).toEqual({ status: 'playing', track: 0, error: false })
  })

  it('applies the shared volume and SOUND OFF to the player', async () => {
    const { source, player } = await playing({ volume: 40, muted: true })
    expect(player.volume).toBe(40)
    expect(player.muted).toBe(true)
    source.setVolume(90)
    expect(player.volume).toBe(90)
    source.setMuted(false)
    expect(player.muted).toBe(false)
  })

  it('pauses and resumes, and reports the clock from the player', async () => {
    const { source, player } = await playing()
    player.time = 42
    expect(source.clock()).toEqual({ elapsed: 42, duration: 200 })
    source.press('toggle')
    expect(player.calls.at(-1)).toBe('pause')
    expect(source.snapshot().status).toBe('paused')
    source.press('toggle')
    expect(player.calls.at(-1)).toBe('play')
  })

  it('NEXT / PREV load the neighbouring videos; PREV late in a track restarts it', async () => {
    const { source, player, changes } = await playing()
    source.press('next')
    expect(player.calls.at(-1)).toBe(`load:${IDS[1]}`)
    expect(changes.at(-1)?.track).toBe(1)
    player.state(YT_STATE.playing)
    player.time = 30
    source.press('prev')
    expect(player.calls.at(-1)).toBe('seek:0')
    player.time = 1
    source.press('prev')
    expect(player.calls.at(-1)).toBe(`load:${IDS[0]}`)
    source.press('prev')
    expect(source.snapshot().track).toBe(2)
  })

  it('rolls into the next video when one ends (and wraps after the last)', async () => {
    const { source, player } = await playing()
    player.state(YT_STATE.ended)
    expect(player.calls.at(-1)).toBe(`load:${IDS[1]}`)
    expect(source.snapshot().track).toBe(1)
    source.playTrack(2)
    player.state(YT_STATE.playing)
    player.state(YT_STATE.ended)
    expect(source.snapshot().track).toBe(0)
  })

  it('shows ERR for about a second on an error, then skips to the next video', async () => {
    const { source, player, clock } = await playing()
    player.fail(150)
    expect(source.snapshot().error).toBe(true)
    expect(player.calls.at(-1)).not.toBe(`load:${IDS[1]}`)
    clock.advance(ERROR_SKIP_MS)
    expect(source.snapshot().error).toBe(false)
    expect(player.calls.at(-1)).toBe(`load:${IDS[1]}`)
    expect(source.snapshot().track).toBe(1)
  })

  it('stops (and drops the player) when every video fails', async () => {
    const { source, player, clock } = await playing()
    for (const code of [2, 100, 101]) {
      player.fail(code)
      clock.advance(ERROR_SKIP_MS)
    }
    expect(source.snapshot().status).toBe('stopped')
    expect(player.destroyed).toBe(true)
  })

  it('reads ERR then stops when the API cannot load (offline, blocked)', async () => {
    const { source, clock } = await setup({ loadApi: () => Promise.reject(new Error('blocked')) })
    source.press('play')
    source.attach(fakeHost())
    await Promise.resolve()
    await Promise.resolve()
    expect(source.snapshot().error).toBe(true)
    clock.advance(ERROR_SKIP_MS)
    expect(source.snapshot().status).toBe('stopped')
  })

  it('pauses in a hidden tab and resumes on return only if it was playing', async () => {
    const { source, player } = await playing()
    source.setHidden(true)
    expect(player.calls.at(-1)).toBe('pause')
    player.state(YT_STATE.paused)
    source.setHidden(false)
    expect(player.calls.at(-1)).toBe('play')
    source.press('pause')
    player.state(YT_STATE.paused)
    const before = player.calls.length
    source.setHidden(true)
    source.setHidden(false)
    expect(player.calls.length).toBe(before)
  })

  it('STOP (eject) destroys the player and ignores its late events', async () => {
    const { source, player, changes } = await playing()
    source.press('stop')
    expect(player.destroyed).toBe(true)
    expect(changes.at(-1)?.status).toBe('stopped')
    player.state(YT_STATE.playing)
    expect(source.snapshot().status).toBe('stopped')
  })

  it('never leaves a hidden player behind: the monitor going away destroys it', async () => {
    const { source, player } = await playing()
    const host = fakeHost()
    source.attach(host)
    source.detach(host)
    expect(player.destroyed).toBe(true)
  })
})
