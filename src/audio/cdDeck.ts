import { JOJI_PLAYLIST } from '../content/playlist'
import { useStore } from '../state/store'
import { audio } from './engine'
import { musicNow } from './music/clock'
import { MusicDeck } from './music/deck'
import { DISCS } from './music/discs'
import { GenerativeSource } from './music/generativeSource'
import { TRACK_SECONDS } from './music/tracks'
import { YouTubeSource } from './youtube/adapter'
import { loadYouTubeApi } from './youtube/loader'

/**
 * The app's CD player deck: disc 1 (the generated lo-fi, driven through the
 * store's `cd` state) and disc 2 (Joji, the YouTube player; its state is
 * mirrored into the store's `yt`). Nothing YouTube happens until PLAY on disc 2.
 */

const BROWSER_TIMERS = {
  set: (callback: () => void, ms: number) => window.setTimeout(callback, ms),
  clear: (id: number) => window.clearTimeout(id),
}

export const youtube = new YouTubeSource({
  disc: DISCS.joji,
  videoIds: JOJI_PLAYLIST.tracks.map((track) => track.videoId),
  loadApi: () => loadYouTubeApi(),
  timers: BROWSER_TIMERS,
  origin: typeof window === 'undefined' ? '' : window.location.origin,
  onChange: (snapshot) => useStore.getState().setYt(snapshot),
  volume: useStore.getState().volume,
  muted: useStore.getState().muted,
})

const generative = new GenerativeSource(DISCS.tapes, {
  state: () => useStore.getState().cd,
  act: (action) => useStore.getState().cdAction(action),
  playTrack: (index) => useStore.getState().cdPlayTrack(index),
  now: musicNow,
  lengths: TRACK_SECONDS,
  setVolume: (volume) => audio.setMusicVolume(volume),
})

export const cdDeck = new MusicDeck(
  { tapes: generative, joji: youtube },
  {
    disc: () => useStore.getState().disc,
    setDisc: (disc) => useStore.getState().setDisc(disc),
    lid: () => useStore.getState().cd.lid,
    toggleLid: () => useStore.getState().cdAction('lid'),
  },
)
