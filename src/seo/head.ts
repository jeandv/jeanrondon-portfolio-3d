import { LINKS, isWebLink } from '../content/links'
import { PROFILE } from '../content/profile'
import { SITE } from '../content/site'
import { TAPES } from '../content/work'

/**
 * `<head>` tags for the prerendered page (title, description, canonical,
 * Open Graph, Twitter, JSON-LD Person), all from src/content. Plain strings,
 * so the output is deterministic and needs no React hoisting rules.
 */

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/** JSON safe inside `<script>` (no `</script>` breakout). */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Canonical origin with a trailing slash. */
export function canonicalUrl(url = SITE.url): string {
  return new URL('/', url).href
}

/** `en` → `en_US`, `es-AR` → `es_AR` (Open Graph locale format). */
export function ogLocale(locale: string): string {
  const [language = 'en', region] = locale.split(/[-_]/)
  const fallback: Readonly<Record<string, string>> = { en: 'US', es: 'ES' }
  return `${language.toLowerCase()}_${(region ?? fallback[language.toLowerCase()] ?? language).toUpperCase()}`
}

/** schema.org Person for the site owner. */
export function personSchema(): Record<string, unknown> {
  const url = canonicalUrl()
  const knowsAbout = [...new Set(TAPES.flatMap((tape) => tape.stack))]
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: PROFILE.name,
    jobTitle: PROFILE.role,
    description: SITE.description,
    url,
    image: new URL(SITE.ogImage, url).href,
    sameAs: LINKS.filter((link) => isWebLink(link.href)).map((link) => link.href),
    knowsAbout,
  }
}

const meta = (name: string, content: string) => `<meta name="${name}" content="${escapeHtml(content)}" />`
const property = (name: string, content: string) => `<meta property="${name}" content="${escapeHtml(content)}" />`

export function renderHead(): string {
  const url = canonicalUrl()
  const image = new URL(SITE.ogImage, url).href
  return [
    `<title>${escapeHtml(SITE.title)}</title>`,
    meta('description', SITE.description),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    property('og:type', 'website'),
    property('og:site_name', PROFILE.name),
    property('og:title', SITE.title),
    property('og:description', SITE.description),
    property('og:url', url),
    property('og:locale', ogLocale(SITE.locale)),
    property('og:image', image),
    property('og:image:width', '1200'),
    property('og:image:height', '630'),
    property('og:image:alt', SITE.ogImageAlt),
    meta('twitter:card', 'summary_large_image'),
    meta('twitter:title', SITE.title),
    meta('twitter:description', SITE.description),
    meta('twitter:image', image),
    meta('twitter:image:alt', SITE.ogImageAlt),
    `<script type="application/ld+json">${jsonForScript(personSchema())}</script>`,
  ].join('\n    ')
}
