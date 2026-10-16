import { saveMuted } from '../boot/session'
import { useStore } from '../state/store'
import { audio } from './engine'
import { setSfxListener, sfx } from './sfx'

/**
 * Connects the engine to the app: the sfx bus plays through it, the store's
 * `muted` drives the master ramp (and is persisted), a tape route plays the
 * tape-in thump, and a hidden tab suspends the context. Returns the cleanup.
 */
export function startAudio(): () => void {
  const removeListener = setSfxListener((id) => {
    audio.play(id)
  })
  audio.setMuted(useStore.getState().muted)

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.muted !== previous.muted) {
      audio.setMuted(state.muted)
      saveMuted(state.muted)
    }
    const tape = state.route.tape
    if (state.phase === 'live' && tape !== undefined && tape !== previous.route.tape) sfx('tape')
  })

  const onVisibility = () => audio.setHidden(document.visibilityState === 'hidden')
  onVisibility()
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    removeListener()
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
