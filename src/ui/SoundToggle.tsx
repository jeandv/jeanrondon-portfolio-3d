import { audio } from '../audio/engine'
import { sfx } from '../audio/sfx'
import { useStore } from '../state/store'

function toggleSound(): void {
  const next = !useStore.getState().muted
  // Store first (audio/wiring.ts ramps the master and persists it), then unlock:
  // this click is a gesture, so it can create or resume the AudioContext.
  useStore.getState().setMuted(next)
  audio.unlock()
  if (!next) sfx('click')
}

/** SOUND ON / SOUND OFF pill (bottom right). M is deliberately not bound (the reference uses it for the CD player). */
export function SoundToggle() {
  const muted = useStore((state) => state.muted)
  return (
    <button type="button" className="s-pill" aria-pressed={!muted} onClick={toggleSound}>
      {muted ? 'Sound off' : 'Sound on'}
    </button>
  )
}
