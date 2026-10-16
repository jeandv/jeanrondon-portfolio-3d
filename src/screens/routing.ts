import type { Route } from '../state/router'

/**
 * Which channel each screen shows per route, and which screen receives the
 * keyboard (pure, three-free: used by the DOM keyboard hook and the 3D objects).
 */

export type ScreenDevice = 'tv' | 'pc' | 'notepad'

export interface ViewState {
  readonly route: Route
  readonly zoom: 'tv' | null
}

export type TvChannelKey = { readonly kind: 'home' } | { readonly kind: 'insertTape' } | { readonly kind: 'tape'; readonly tape: string }

export type PcChannelKey = 'idle' | 'about' | 'contact'

/** home/about/online → title card (the TV stays on); #work → INSERT TAPE; #work/<id> → that tape. */
export function tvChannelFor(route: Route): TvChannelKey {
  if (route.page !== 'work') return { kind: 'home' }
  return route.tape ? { kind: 'tape', tape: route.tape } : { kind: 'insertTape' }
}

/**
 * The TV with the tape deck: a `#work/<id>` route shows that tape only once
 * it is playing in the VCR (`playing`); until then (flying in, another tape
 * still coming out) the blue INSERT TAPE screen.
 */
export function tvChannelForDeck(route: Route, playing: string | null): TvChannelKey {
  const key = tvChannelFor(route)
  return key.kind === 'tape' && key.tape !== playing ? { kind: 'insertTape' } : key
}

export function sameTvChannel(a: TvChannelKey, b: TvChannelKey): boolean {
  return a.kind === b.kind && (a.kind !== 'tape' || (b.kind === 'tape' && a.tape === b.tape))
}

/** about → pager, online → contact menu, anything else → `C:\>_`. */
export function pcChannelFor(route: Route): PcChannelKey {
  switch (route.page) {
    case 'about':
      return 'about'
    case 'online':
      return 'contact'
    default:
      return 'idle'
  }
}

/** Screens that receive arrows/Enter/Space/digits, in priority order. */
export function focusedDevices({ route, zoom }: ViewState): readonly ScreenDevice[] {
  if (zoom === 'tv') return ['tv']
  switch (route.page) {
    case 'about':
    case 'online':
      return ['pc']
    case 'work':
      return ['notepad', 'tv']
    default:
      return []
  }
}

/** Whether pointer hits on a screen are live (the camera is looking at it). */
export function isInteractive(device: ScreenDevice, { route, zoom }: ViewState): boolean {
  switch (device) {
    case 'pc':
      return zoom === null && (route.page === 'about' || route.page === 'online')
    case 'notepad':
      return zoom === null && route.page === 'work'
    case 'tv':
      return zoom === 'tv' || route.page === 'work'
  }
}

const SCREEN_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
  'PageUp',
  'PageDown',
])

/** Keys forwarded to the focused screen's channel. */
export function isScreenKey(key: string): boolean {
  return SCREEN_KEYS.has(key) || /^[0-9]$/.test(key)
}
