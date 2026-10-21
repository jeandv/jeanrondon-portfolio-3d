import { saveMuted } from '../boot/session'
import { useStore } from '../state/store'
import { cdDeck } from './cdDeck'
import { audio } from './engine'
import { setMusicClock } from './music/clock'
import { setModemListener, setSfxListener } from './sfx'
import { saveVolume } from './volume'

/**
 * Connects the engine to the app: the sfx bus plays through it, the store's
 * `muted` drives the master ramp and the YouTube player's mute (and is
 * persisted), the CD player's state drives the generated music (which runs
 * on the AudioContext's clock), the shared volume reaches both discs (and is
 * persisted), the YouTube disc ducks the rain while it plays, and a hidden
 * tab suspends the context and pauses the video. (The tape thump / eject
 * click come from the tape deck itself.) Returns the cleanup.
 */
export function startAudio(): () => void {
  const removeListener = setSfxListener((id) => {
    audio.play(id)
  })
  const removeModem = setModemListener((plan) => audio.startModem(plan))
  const restoreClock = setMusicClock(() => audio.musicNow())
  const initial = useStore.getState()
  audio.setMuted(initial.muted)
  audio.syncMusic(initial.cd)
  cdDeck.setVolume(initial.volume)
  cdDeck.setMuted(initial.muted)

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.muted !== previous.muted) {
      audio.setMuted(state.muted)
      cdDeck.setMuted(state.muted)
      saveMuted(state.muted)
    }
    if (state.cd !== previous.cd) audio.syncMusic(state.cd)
    if (state.volume !== previous.volume) {
      cdDeck.setVolume(state.volume)
      saveVolume(state.volume)
    }
    if (state.yt.status !== previous.yt.status) audio.setExternalMusic(state.yt.status === 'playing' || state.yt.status === 'loading')
  })

  const onVisibility = () => {
    const hidden = document.visibilityState === 'hidden'
    audio.setHidden(hidden)
    cdDeck.setHidden(hidden)
  }
  onVisibility()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    removeListener()
    removeModem()
    restoreClock()
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
