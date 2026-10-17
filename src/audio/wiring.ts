import { saveMuted } from '../boot/session'
import { useStore } from '../state/store'
import { audio } from './engine'
import { setMusicClock } from './music/clock'
import { setModemListener, setSfxListener } from './sfx'

/**
 * Connects the engine to the app: the sfx bus plays through it, the store's
 * `muted` drives the master ramp (and is persisted), the CD player's state
 * drives the music (which runs on the AudioContext's clock), and a hidden tab
 * suspends the context. (The tape thump / eject click come from the tape deck
 * itself, as the tape goes in or out.) Returns the cleanup.
 */
export function startAudio(): () => void {
  const removeListener = setSfxListener((id) => {
    audio.play(id)
  })
  const removeModem = setModemListener((plan) => audio.startModem(plan))
  const restoreClock = setMusicClock(() => audio.musicNow())
  audio.setMuted(useStore.getState().muted)
  audio.syncMusic(useStore.getState().cd)

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.muted !== previous.muted) {
      audio.setMuted(state.muted)
      saveMuted(state.muted)
    }
    if (state.cd !== previous.cd) audio.syncMusic(state.cd)
  })

  const onVisibility = () => audio.setHidden(document.visibilityState === 'hidden')
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
