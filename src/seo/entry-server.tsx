import { renderToStaticMarkup } from 'react-dom/server'
import { SITE } from '../content/site'
import { renderHead } from './head'
import { SeoContent } from './SeoContent'

export interface PrerenderResult {
  /** `<html lang>`. */
  readonly lang: string
  /** Fills the `<!--head-->` slot of index.html. */
  readonly head: string
  /** Fills the `<!--seo-->` slot inside `#seo`. */
  readonly body: string
}

/** SSR entry for scripts/prerender.mjs (`vite build --ssr src/seo/entry-server.tsx`). */
export function render(): PrerenderResult {
  return { lang: SITE.locale, head: renderHead(), body: renderToStaticMarkup(<SeoContent />) }
}
