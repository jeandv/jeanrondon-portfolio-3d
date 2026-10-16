import { describe, expect, it } from 'vitest'
import { SITE } from '../content/site'
import { render } from './entry-server'
import { canonicalUrl } from './head'
import { isPlaceholderUrl, sitemapUrl, sitemapXml, w3cDate, withSitemapLine } from './sitemap'

describe('sitemap.xml', () => {
  const date = new Date('2026-10-15T12:00:00Z')

  it('lists the canonical root with a W3C lastmod', () => {
    const xml = sitemapXml('https://jean.dev/some/page', date)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://jean.dev/</loc>')
    expect(xml).toContain('<lastmod>2026-10-15</lastmod>')
    expect(xml.match(/<url>/g)).toHaveLength(1)
    expect(w3cDate(date)).toBe('2026-10-15')
  })

  it('escapes the location and omits lastmod when not given', () => {
    const xml = sitemapXml('https://jean.dev/?a=1&b=2')
    expect(xml).toContain('<loc>https://jean.dev/</loc>')
    expect(xml).not.toContain('<lastmod>')
  })

  it('adds exactly one absolute Sitemap line to robots.txt', () => {
    expect(sitemapUrl('https://jean.dev')).toBe('https://jean.dev/sitemap.xml')
    const once = withSitemapLine('User-agent: *\nAllow: /\n', 'https://jean.dev')
    expect(once).toBe('User-agent: *\nAllow: /\n\nSitemap: https://jean.dev/sitemap.xml\n')
    expect(withSitemapLine(once, 'https://other.dev')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://other.dev/sitemap.xml\n',
    )
  })

  it('flags the scaffold URL as a placeholder', () => {
    expect(isPlaceholderUrl('https://example.com')).toBe(true)
    expect(isPlaceholderUrl('https://jean.dev')).toBe(false)
  })
})

describe('SSR entry', () => {
  it('returns head, body, sitemap and robots for scripts/prerender.mjs', () => {
    const result = render(new Date('2026-01-02T00:00:00Z'))
    expect(result.lang).toBe(SITE.locale)
    expect(result.url).toBe(canonicalUrl(SITE.url))
    expect(result.placeholderUrl).toBe(isPlaceholderUrl(SITE.url))
    expect(result.body).toContain('<h1')
    expect(result.sitemap).toContain(`<loc>${canonicalUrl(SITE.url)}</loc>`)
    expect(result.sitemap).toContain('<lastmod>2026-01-02</lastmod>')
    expect(result.robots('User-agent: *\n')).toContain(`Sitemap: ${canonicalUrl(SITE.url)}sitemap.xml`)
  })
})
