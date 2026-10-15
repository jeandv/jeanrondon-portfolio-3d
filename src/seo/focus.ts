import type { Page } from '../state/router'

/**
 * Section focus (plan §5.10): after a keyboard shortcut or a nav click, focus
 * moves to the heading of `#s-<page>` in the SEO layer, never on load or after
 * a click inside the 3D scene. A request expires if no page change follows.
 */

const REQUEST_TTL_MS = 1500

let requestedAt = Number.NEGATIVE_INFINITY

export function requestSectionFocus(now = performance.now()): void {
  requestedAt = now
}

/** Consumes a pending request (true when one was made recently). */
export function takeSectionFocusRequest(now = performance.now()): boolean {
  const pending = now - requestedAt <= REQUEST_TTL_MS
  requestedAt = Number.NEGATIVE_INFINITY
  return pending
}

/** DOM id of a page's section (never equal to a route, so the browser never jumps to it). */
export function sectionId(page: Page): string {
  return `s-${page}`
}

export function sectionHeading(page: Page): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#${sectionId(page)} h2, #${sectionId(page)} h1`)
}
