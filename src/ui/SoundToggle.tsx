import { useStore } from '../state/store'

/** Placeholder pill: only flips `muted` in the store. TODO(M5): audio engine + localStorage. */
export function SoundToggle() {
  const muted = useStore((state) => state.muted)
  const setMuted = useStore((state) => state.setMuted)
  return (
    <button type="button" className="s-pill" aria-pressed={!muted} onClick={() => setMuted(!muted)}>
      {muted ? 'Sound off' : 'Sound on'}
    </button>
  )
}
