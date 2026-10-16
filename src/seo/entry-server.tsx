import { renderToStaticMarkup } from 'react-dom/server'
import { SITE } from '../content/site'
import { canonicalUrl, renderHead } from './head'
import { SeoContent } from './SeoContent'
import { isPlaceholderUrl, sitemapXml, withSitemapLine } from './sitemap'

export interface PrerenderResult {
  /** `<html lang>`. */
  readonly lang: string
  /** Fills the `<!--head-->` slot of index.html. */
  readonly head: string
  /** Fills the `<!--seo-->` slot inside `#seo`. */
  readonly body: string
  /** Canonical origin (SITE.url) with a trailing slash. */
  readonly url: string
  /** True while SITE.url is still the example.com placeholder. */
  readonly placeholderUrl: boolean
  /** dist/sitemap.xml. */
  readonly sitemap: string
  /** public/robots.txt plus the absolute `Sitemap:` line. */
  readonly robots: (source: string) => string
}

/** SSR entry for scripts/prerender.mjs (`vite build --ssr src/seo/entry-server.tsx`). */
export function render(now: Date = new Date()): PrerenderResult {
  const url = canonicalUrl(SITE.url)
  return {
    lang: SITE.locale,
    head: renderHead(),
    body: renderToStaticMarkup(<SeoContent />),
    url,
    placeholderUrl: isPlaceholderUrl(url),
    sitemap: sitemapXml(url, now),
    robots: (source) => withSitemapLine(source, url),
  }
}
