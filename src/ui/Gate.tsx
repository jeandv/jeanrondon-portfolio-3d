import type { MouseEvent } from 'react'
import { enterRoom } from '../boot/controller'

export interface GateProps {
  /** False while entering: the buttons stay on screen for the static burst but no longer work. */
  readonly active: boolean
}

function enterWith(sound: boolean) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    // The loader backdrop also enters (with sound) on click; this button decides instead.
    event.stopPropagation()
    enterRoom({ sound })
  }
}

const enterWithSound = enterWith(true)
const enterMuted = enterWith(false)

/**
 * The gate drawn inside the VCR OSD (plan §1: "CLICK TO ENTER / ENTER
 * MUTED"). Two real, focusable buttons (Enter / Space work natively; the
 * loader also maps Enter / Space anywhere to the first one). The click is the
 * gesture that creates the AudioContext.
 */
export function Gate({ active }: GateProps) {
  return (
    <div className="s-gate">
      <p className="s-osd-top" aria-hidden="true">
        <span className="s-osd-mode">
          <span className="s-osd-glyphs">
            <span className="s-osd-play" />
          </span>
          Play
        </span>
        <span>CH 00</span>
      </p>
      <button type="button" className="s-gate-enter" disabled={!active} onClick={enterWithSound}>
        Click to enter<span className="s-sr-only"> the room (sound on)</span>
      </button>
      <button type="button" className="s-gate-muted" disabled={!active} onClick={enterMuted}>
        Enter muted
      </button>
    </div>
  )
}
