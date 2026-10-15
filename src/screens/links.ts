import { isWebLink } from '../content/links'

const ALLOWED = /^(https?:\/\/|mailto:)/i

/**
 * Opens a content link from a screen (must run inside a click/keydown so the
 * popup is allowed): web links in a new tab with noopener, mailto in place.
 */
export function openExternal(href: string): void {
  if (!ALLOWED.test(href)) return
  if (isWebLink(href)) {
    window.open(href, '_blank', 'noopener,noreferrer')
  } else {
    window.location.href = href
  }
}
