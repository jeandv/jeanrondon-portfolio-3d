import { Fragment } from 'react'
import { useStore, type AppState } from '../state/store'

interface Hint {
  readonly keys: string
  readonly text: string
}

type HintSet = 'home' | 'work' | 'pc' | 'tv'

const HINTS: Readonly<Record<HintSet, readonly Hint[]>> = {
  home: [
    { keys: 'C', text: 'use computer' },
    { keys: 'Z', text: 'zoom TV' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  work: [
    { keys: '1–8', text: 'play a tape' },
    { keys: 'Z', text: 'zoom TV' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  pc: [
    { keys: 'Z', text: 'zoom TV' },
    { keys: 'ESC', text: 'back to desk' },
  ],
  tv: [
    { keys: 'Z', text: 'leave TV' },
    { keys: 'ESC', text: 'back' },
  ],
}

function hintSet(state: AppState): HintSet {
  if (state.zoom === 'tv') return 'tv'
  switch (state.route.page) {
    case 'home':
      return 'home'
    case 'work':
      return 'work'
    case 'about':
    case 'online':
      return 'pc'
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
