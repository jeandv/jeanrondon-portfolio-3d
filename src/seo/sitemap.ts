import { canonicalUrl, escapeHtml } from './head'

/**
 * sitemap.xml and the robots.txt `Sitemap:` line (plan §8), written next to
 * dist/index.html by scripts/prerender.mjs from SITE.url. Hash routes (#work,
 * #about…) are one document for crawlers, so the sitemap lists the root only.
 */

/** `YYYY-MM-DD` (W3C date) for <lastmod>. */
export function w3cDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function sitemapXml(url: string = canonicalUrl(), lastmod?: Date): string {
  const loc = canonicalUrl(url)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${escapeHtml(loc)}</loc>`,
    ...(lastmod ? [`    <lastmod>${w3cDate(lastmod)}</lastmod>`] : []),
    '  </url>',
    '</urlset>',
    '',
  ]
  return lines.join('\n')
}

/** Absolute sitemap URL for robots.txt. */
export function sitemapUrl(url: string = canonicalUrl()): string {
  return new URL('sitemap.xml', canonicalUrl(url)).href
}

/** Appends (or replaces) the `Sitemap:` line of a robots.txt. */
export function withSitemapLine(robots: string, url: string = canonicalUrl()): string {
  const kept = robots
    .split(/\r?\n/)
    .filter((line) => !/^sitemap:/i.test(line.trim()))
    .join('\n')
    .trimEnd()
  return `${kept}\n\nSitemap: ${sitemapUrl(url)}\n`
}

/** Whether SITE.url still is the scaffold placeholder (the build warns about it). */
export function isPlaceholderUrl(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'example.com' || host.endsWith('.example.com') || host === 'localhost'
}
