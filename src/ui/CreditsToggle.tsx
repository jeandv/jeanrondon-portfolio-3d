import { sfx } from '../audio/sfx'
import { useStore } from '../state/store'

function toggleCredits(): void {
  const state = useStore.getState()
  // The card lives in the 3D room: nothing to show before it is live.
  if (state.phase !== 'live') return
  sfx('card')
  state.toggleCredits()
}

/** CREDITS pill (bottom right, beside SOUND): the index card floats up from the rolodex; again (or Esc) puts it back. */
export function CreditsToggle() {
  const open = useStore((state) => state.creditsOpen)
  return (
    <button type="button" className="s-pill" aria-expanded={open} onClick={toggleCredits}>
      Credits
    </button>
  )
}
