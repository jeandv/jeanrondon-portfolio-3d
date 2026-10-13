import { tapeById } from '../content/work'
import type { Page } from '../state/router'
import { useStore, type AppState } from '../state/store'

const PAGE_LABEL: Readonly<Record<Page, string>> = {
  home: 'Desk',
  about: 'About',
  work: 'Work',
  online: 'Online',
}

function announcement(state: AppState): string {
  if (state.zoom === 'tv') return 'Viewing: TV'
  const tape = tapeById(state.route.tape)
  return `Viewing: ${PAGE_LABEL[state.route.page]}${tape ? ` — ${tape.title}` : ''}`
}

/** Screen-reader announcement of the current view. TODO(M2): move focus to the section h2. */
export function LiveRegion() {
  const text = useStore(announcement)
  return (
    <p className="s-sr-only" role="status" aria-live="polite">
      {text}
    </p>
  )
}
