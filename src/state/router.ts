/**
 * Hash router: `#home`, `#about`, `#work`, `#work/<tapeId>`, `#online`.
 * `#contact` / `#github` alias to `online`; anything else resolves to `home`.
 */

export const PAGES = ['home', 'about', 'work', 'online'] as const
export type Page = (typeof PAGES)[number]

export interface Route {
  readonly page: Page
  readonly tape?: string
}

export const HOME: Route = { page: 'home' }

const ALIASES: Readonly<Record<string, Page>> = {
  '': 'home',
  home: 'home',
  about: 'about',
  work: 'work',
  online: 'online',
  contact: 'online',
  github: 'online',
}

const TAPE_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Pure hash → route parser. When `tapeIds` is given, unknown tape ids are
 * dropped (the route stays on `work`).
 */
export function parseHash(hash: string, tapeIds?: ReadonlySet<string>): Route {
  const clean = hash.replace(/^#\/?/, '').trim().toLowerCase()
  const [head = '', tape] = clean.split('/')
  const page = Object.hasOwn(ALIASES, head) ? ALIASES[head] : undefined
  if (page === undefined) return HOME
  if (page !== 'work' || tape === undefined || !TAPE_ID.test(tape)) return { page }
  if (tapeIds && !tapeIds.has(tape)) return { page }
  return { page, tape }
}

export function toHash(route: Route): string {
  return route.page === 'work' && route.tape ? `#work/${route.tape}` : `#${route.page}`
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.page === b.page && a.tape === b.tape
}

/** Reflects the active page on `<body data-route>` (drives the nav pill via CSS). */
export function applyRouteToDocument(route: Route): void {
  document.body.dataset.route = route.page
}

/**
 * Starts listening to `hashchange` (so back/forward also fly the camera).
 * Emits the current route immediately. Returns the unsubscribe function.
 */
export function startRouter(onRoute: (route: Route) => void, tapeIds?: ReadonlySet<string>): () => void {
  const emit = () => {
    const route = parseHash(window.location.hash, tapeIds)
    applyRouteToDocument(route)
    onRoute(route)
  }
  emit()
  window.addEventListener('hashchange', emit)
  return () => window.removeEventListener('hashchange', emit)
}
