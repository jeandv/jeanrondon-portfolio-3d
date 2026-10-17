import { saveMuted } from '../boot/session'
import { useStore } from '../state/store'
import { audio } from './engine'
import { setModemListener, setSfxListener } from './sfx'

/**
 * Connects the engine to the app: the sfx bus plays through it, the store's
 * `muted` drives the master ramp (and is persisted), and a hidden tab
 * suspends the context. (The tape thump / eject click come from the tape deck
 * itself, as the tape goes in or out.) Returns the cleanup.
 */
export function startAudio(): () => void {
  const removeListener = setSfxListener((id) => {
    audio.play(id)
  })
  const removeModem = setModemListener((plan) => audio.startModem(plan))
  audio.setMuted(useStore.getState().muted)

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.muted !== previous.muted) {
      audio.setMuted(state.muted)
      saveMuted(state.muted)
    }
  })

  const onVisibility = () => audio.setHidden(document.visibilityState === 'hidden')
  onVisibility()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    removeListener()
    removeModem()
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
