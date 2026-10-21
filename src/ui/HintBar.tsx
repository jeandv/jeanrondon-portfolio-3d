import { Fragment } from 'react'
import { LINKS } from '../content/links'
import { TAPES } from '../content/work'
import { slotKeys } from '../screens/keys'
import { useStore, type AppState } from '../state/store'

interface Hint {
  readonly keys: string
  readonly text: string
}

type HintSet = 'home' | 'work' | 'about' | 'online' | 'tv' | 'cd' | 'calculator'

const HINTS: Readonly<Record<HintSet, readonly Hint[]>> = {
  // The reference's line: "C use computer · M use CD player · Z zoom TV".
  home: [
    { keys: 'C', text: 'use computer' },
    { keys: 'M', text: 'use CD player' },
    { keys: 'Z', text: 'zoom TV' },
  ],
  work: [
    // Digit keys follow the shelf slots (gaps included), e.g. "1–3, 6".
    { keys: slotKeys(TAPES.map((tape) => tape.slot), '–'), text: 'play a tape' },
    { keys: '↑↓', text: 'change tape' },
    { keys: 'Z', text: 'zoom TV' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  about: [
    { keys: 'SPACE', text: 'next page' },
    { keys: '↑↓', text: 'scroll' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  online: [
    { keys: `1–${LINKS.length}`, text: 'open a link' },
    { keys: '↑↓ ENTER', text: 'select' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  tv: [
    { keys: 'Z', text: 'leave TV' },
    { keys: 'ESC', text: 'back' },
  ],
  cd: [
    { keys: 'SPACE', text: 'play / pause' },
    { keys: '←→', text: 'track' },
    { keys: '↑↓', text: 'volume' },
    { keys: 'S', text: 'stop' },
    { keys: 'D', text: 'disc' },
    { keys: 'M', text: 'leave' },
  ],
  calculator: [
    { keys: '0–9 + − × ÷', text: 'type' },
    { keys: 'ENTER', text: 'equals' },
    { keys: 'ESC', text: 'clear / put down' },
  ],
}

function hintSet(state: AppState): HintSet {
  if (state.calcUp) return 'calculator'
  if (state.zoom === 'tv') return 'tv'
  if (state.zoom === 'cd') return 'cd'
  switch (state.route.page) {
    case 'home':
      return 'home'
    case 'work':
      return 'work'
    case 'about':
      return 'about'
    case 'online':
      return 'online'
  }
}

/** Keyboard hints for the current view (hidden on phones via CSS). */
export function HintBar() {
  const set = useStore(hintSet)
  return (
    <p className="s-hintbar">
      {HINTS[set].map((hint, i) => (
        <Fragment key={hint.keys}>
          {i > 0 && <span className="s-hint-sep" aria-hidden="true"> · </span>}
          <kbd>{hint.keys}</kbd> {hint.text}
        </Fragment>
      ))}
    </p>
  )
}
