import { useEffect } from 'react'
import type { Route } from '../state/router'
import { useStore } from '../state/store'
import { sectionHeading, sectionId, takeSectionFocusRequest } from './focus'

/** Element a route points at in the readable (no-WebGL) layout. */
function routeTarget(route: Route): HTMLElement | null {
  const id = route.tape ? `s-tape-${route.tape}` : sectionId(route.page)
  return document.getElementById(id)
}

function scrollToRoute(route: Route, reducedMotion: boolean): void {
  routeTarget(route)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
}

/**
 * Keeps keyboard/screen-reader users in step with the 3D navigation: after a
 * keyboard or nav page change, focus moves to `#s-<page>` h2 (h1 on home).
 * Without WebGL the readable layout also scrolls to the route's section.
 */
export function useSectionFocus(webgl: boolean): void {
  useEffect(() => {
    if (!webgl) {
      const { route } = useStore.getState()
      if (route.page !== 'home') scrollToRoute(route, true)
    }
    return useStore.subscribe((state, previous) => {
      if (state.route === previous.route) return
      if (!webgl) scrollToRoute(state.route, state.reducedMotion)
      if (state.route.page === previous.route.page) return
      if (takeSectionFocusRequest()) sectionHeading(state.route.page)?.focus({ preventScroll: true })
    })
  }, [webgl])

  // With WebGL, tabbing into a link opens #seo as a side panel (styles/seo.css).
  // The link was scrolled into view while the layer was still 1 px tall, so
  // scroll it again once the panel has its real size.
  useEffect(() => {
    const seo = document.getElementById('seo')
    if (!webgl || !seo) return
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLAnchorElement) requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest' }))
    }
    seo.addEventListener('focusin', onFocusIn)
    return () => seo.removeEventListener('focusin', onFocusIn)
  }, [webgl])
}
