import { describe, expect, it } from 'vitest'
import { JOJI_PLAYLIST } from '../../content/playlist'
import { isCanvasSafe } from '../../screens/text'
import { CD_STOPPED, cdPress, type CdLid, type CdState } from '../../three/objects/cd/player'
import { clampVolume, DEFAULT_VOLUME, loadVolume, musicGain, saveVolume, stepVolume, VOLUME_KEY, volumeSegments } from '../volume'
import { MusicDeck } from './deck'
import { DISCS, nextDisc, type DiscId } from './discs'
import { GenerativeSource } from './generativeSource'
import type { MusicSource, SourceAction, SourceSnapshot } from './source'
import { TRACK_SECONDS } from './tracks'

/** A source that records what it is told. */
class FakeSource implements MusicSource {
  readonly disc = DISCS.joji
  status: SourceSnapshot['status'] = 'stopped'
  readonly log: string[] = []
  snapshot(): SourceSnapshot {
    return { status: this.status, track: 0, error: false }
  }
  clock() {
    return { elapsed: 0, duration: null }
  }
  press(action: SourceAction) {
    this.log.push(action)
    if (action === 'stop') this.status = 'stopped'
    if (action === 'toggle' || action === 'play') this.status = 'playing'
  }
  playTrack(index: number) {
    this.log.push(`track:${index}`)
    this.status = 'playing'
  }
  setVolume(volume: number) {
    this.log.push(`volume:${volume}`)
  }
  setMuted(muted: boolean) {
    this.log.push(`muted:${muted}`)
  }
  setHidden(hidden: boolean) {
    this.log.push(`hidden:${hidden}`)
  }
}

function setup() {
  let cd: CdState = CD_STOPPED
  let disc: DiscId = 'tapes'
  let volume = -1
  const generative = new GenerativeSource(DISCS.tapes, {
    state: () => cd,
    act: (action) => {
      cd = cdPress(cd, action, TRACK_SECONDS, 0)
    },
    playTrack: (index) => {
      cd = { ...cd, status: 'playing', track: index, position: 0, since: 0, lid: 'closed' }
    },
    now: () => 0,
    lengths: TRACK_SECONDS,
    setVolume: (value) => {
      volume = value
    },
  })
  const youtube = new FakeSource()
  const deck = new MusicDeck(
    { tapes: generative, joji: youtube },
    {
      disc: () => disc,
      setDisc: (next) => {
        disc = next
      },
      lid: (): CdLid => cd.lid,
      toggleLid: () => {
        cd = cdPress(cd, 'lid', TRACK_SECONDS, 0)
      },
    },
  )
  return { deck, youtube, cd: () => cd, disc: () => disc, volume: () => volume }
}

describe('the CD deck (source-agnostic)', () => {
  it('routes the buttons to the disc in the player', () => {
    const { deck, youtube, cd } = setup()
    deck.press('toggle')
    expect(cd().status).toBe('playing')
    expect(youtube.log).toEqual([])
    deck.press('next')
    expect(cd().track).toBe(1)
  })

  it('DISC ejects the playing disc and puts the other one in, stopped', () => {
    const { deck, youtube, cd, disc } = setup()
    deck.press('toggle')
    expect(deck.swapDisc()).toBe('joji')
    expect(cd().status).toBe('stopped')
    expect(disc()).toBe('joji')
    expect(deck.active()).toBe(youtube)
    deck.press('toggle')
    expect(youtube.status).toBe('playing')
    deck.swapDisc()
    expect(youtube.log.at(-1)).toBe('stop')
    expect(disc()).toBe('tapes')
  })

  it('only one source plays: starting one stops the other', () => {
    const { deck, youtube, cd, disc } = setup()
    youtube.status = 'playing'
    deck.press('play')
    expect(youtube.status).toBe('stopped')
    expect(cd().status).toBe('playing')
    expect(disc()).toBe('tapes')
  })

  it('opening the lid stops whatever plays; PLAY shuts it again', () => {
    const { deck, cd } = setup()
    deck.press('toggle')
    deck.lid()
    expect(cd().lid).toBe('open')
    expect(cd().status).toBe('stopped')
    deck.press('toggle')
    expect(cd().lid).toBe('closed')
    expect(cd().status).toBe('playing')
  })

  it('passes the volume, SOUND OFF and the hidden tab to every source', () => {
    const { deck, youtube, volume } = setup()
    deck.setVolume(60)
    deck.setMuted(true)
    deck.setHidden(true)
    expect(volume()).toBe(60)
    expect(youtube.log).toEqual(['volume:60', 'muted:true', 'hidden:true'])
  })

  it('reports the generated disc through the same interface', () => {
    const { deck } = setup()
    deck.playTrack(2)
    const source = deck.active()
    expect(source.snapshot()).toEqual({ status: 'playing', track: 2, error: false })
    expect(source.clock().duration).toBeCloseTo(TRACK_SECONDS[2] ?? 0)
  })
})

describe('discs and the Joji playlist', () => {
  it('has two discs, numbered, that swap in turn', () => {
    expect(DISCS.tapes.number).toBe(1)
    expect(DISCS.joji.number).toBe(2)
    expect(nextDisc('tapes')).toBe('joji')
    expect(nextDisc('joji')).toBe('tapes')
    expect(DISCS.tapes.tracks).toHaveLength(TRACK_SECONDS.length)
  })

  it('lists official video ids: 11 characters, no duplicates, LCD-safe titles', () => {
    const ids = JOJI_PLAYLIST.tracks.map((track) => track.videoId)
    expect(ids.length).toBeGreaterThanOrEqual(1)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/)
    expect(new Set(ids).size).toBe(ids.length)
    for (const track of JOJI_PLAYLIST.tracks) expect(isCanvasSafe(track.title)).toBe(true)
    expect(JOJI_PLAYLIST.artist).toBe('Joji')
    expect(JOJI_PLAYLIST.source).toContain('88rising')
  })
})

describe('the shared music volume', () => {
  it('clamps, steps by ten and lights 0–10 LCD segments', () => {
    expect(clampVolume(140)).toBe(100)
    expect(clampVolume(-3)).toBe(0)
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME)
    expect(stepVolume(80, 1)).toBe(90)
    expect(stepVolume(100, 1)).toBe(100)
    expect(stepVolume(43, -1)).toBe(30)
    expect(stepVolume(0, -1)).toBe(0)
    expect(volumeSegments(0)).toBe(0)
    expect(volumeSegments(55)).toBe(6)
    expect(volumeSegments(100)).toBe(10)
  })

  it('maps the volume to a perceptual gain for the generated disc', () => {
    expect(musicGain(0)).toBe(0)
    expect(musicGain(100)).toBe(1)
    expect(musicGain(50)).toBeLessThan(0.5)
    expect(musicGain(70)).toBeGreaterThan(musicGain(60))
  })

  it('persists in localStorage and survives storage that throws', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
    expect(loadVolume(storage)).toBe(DEFAULT_VOLUME)
    saveVolume(35, storage)
    expect(data.get(VOLUME_KEY)).toBe('35')
    expect(loadVolume(storage)).toBe(35)
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadVolume(broken)).toBe(DEFAULT_VOLUME)
    expect(() => saveVolume(50, broken)).not.toThrow()
    expect(loadVolume(null)).toBe(DEFAULT_VOLUME)
  })
})
