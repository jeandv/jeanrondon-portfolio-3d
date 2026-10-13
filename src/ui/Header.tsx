import type { MouseEvent } from 'react'
import { PROFILE } from '../content/profile'
import type { Page } from '../state/router'
import { useStore } from '../state/store'

interface NavItem {
  readonly page: Exclude<Page, 'home'>
  readonly label: string
}

const NAV: readonly NavItem[] = [
  { page: 'about', label: 'About' },
  { page: 'work', label: 'Work' },
  { page: 'online', label: 'Online' },
]

/**
 * Plain left-clicks go through the store so re-clicking the current page
 * still clears the TV zoom; modified clicks keep native link behavior.
 */
function onNavClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  useStore.getState().navigate(event.currentTarget.hash)
}

export function Header() {
  const page = useStore((state) => state.route.page)
  return (
    <header className="s-header">
      <a className="s-brand" href="#home" onClick={onNavClick}>
        {PROFILE.name}
      </a>
      <nav className="s-nav" aria-label="Sections">
        {NAV.map((item) => (
          <a
            key={item.page}
            className="s-nav-link"
            href={`#${item.page}`}
            data-page={item.page}
            aria-current={page === item.page ? 'page' : undefined}
            onClick={onNavClick}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  )
}
