import { MUSIC } from '../../content/music'
import { JOJI_PLAYLIST } from '../../content/playlist'

/**
 * The two discs that fit the desk's CD player: disc 1, the generated lo-fi
 * (src/content/music.ts, src/audio/music/*), and disc 2, Joji from the
 * official YouTube uploads (src/content/playlist.ts). DISC (or D) swaps them.
 */

export type DiscId = 'tapes' | 'joji'

export interface DiscInfo {
  readonly id: DiscId
  /** 1-based, as printed on the LCD (DISC 1 / DISC 2). */
  readonly number: number
  readonly title: string
  readonly artist: string
  readonly source: 'generative' | 'youtube'
  readonly tracks: readonly string[]
}

export const DISCS: Readonly<Record<DiscId, DiscInfo>> = {
  tapes: {
    id: 'tapes',
    number: 1,
    title: MUSIC.title,
    artist: MUSIC.artist,
    source: 'generative',
    tracks: MUSIC.tracks.map((track) => track.title),
  },
  joji: {
    id: 'joji',
    number: 2,
    title: JOJI_PLAYLIST.title,
    artist: JOJI_PLAYLIST.artist,
    source: 'youtube',
    tracks: JOJI_PLAYLIST.tracks.map((track) => track.title),
  },
}

export const DISC_ORDER: readonly DiscId[] = ['tapes', 'joji']

export function nextDisc(id: DiscId): DiscId {
  return DISC_ORDER[(DISC_ORDER.indexOf(id) + 1) % DISC_ORDER.length] ?? 'tapes'
}
