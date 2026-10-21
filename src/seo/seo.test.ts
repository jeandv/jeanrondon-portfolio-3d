import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { displayHref, LINKS } from '../content/links'
import { PROFILE } from '../content/profile'
import { RESUME } from '../content/resume'
import { SITE } from '../content/site'
import { TAPES } from '../content/work'
import { PAGES } from '../state/router'
import { requestSectionFocus, sectionId, takeSectionFocusRequest } from './focus'
import { canonicalUrl, escapeHtml, jsonForScript, ogLocale, personSchema, renderHead } from './head'
import { SeoContent } from './SeoContent'

describe('head tags', () => {
  const head = renderHead()

  it('has title, description, canonical, OG and Twitter tags from the content', () => {
    expect(head).toContain(`<title>${escapeHtml(SITE.title)}</title>`)
    expect(head).toContain(`<meta name="description" content="${escapeHtml(SITE.description)}" />`)
    expect(head).toContain(`<link rel="canonical" href="${canonicalUrl()}" />`)
    expect(head).toContain('property="og:image" content="https://example.com/og.jpg"')
    expect(head).toContain('name="twitter:card" content="summary_large_image"')
    expect(head).toContain(`property="og:locale" content="${ogLocale(SITE.locale)}"`)
  })

  it('embeds a parseable JSON-LD Person', () => {
    const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(head)
    const json: unknown = JSON.parse(match?.[1] ?? 'null')
    expect(json).toMatchObject({ '@type': 'Person', name: PROFILE.name, jobTitle: PROFILE.role })
    expect(personSchema().sameAs).toEqual(LINKS.filter((link) => link.href.startsWith('https')).map((link) => link.href))
  })

  it('escapes HTML and script breakouts', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
    expect(jsonForScript({ a: '</script>' })).not.toContain('</script>')
    expect(ogLocale('en')).toBe('en_US')
    expect(ogLocale('es-AR')).toBe('es_AR')
  })
})

/** Text as React serializes it (its escaping differs from escapeHtml: `'` → `&#x27;`). */
function reactText(text: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, text))
}

describe('SEO content', () => {
  const html = renderToStaticMarkup(createElement(SeoContent))

  it('renders the h1, the bio and a section per page with an s- id', () => {
    expect(html).toContain(`>${reactText(PROFILE.name)}</h1>`)
    for (const paragraph of PROFILE.bio) expect(html).toContain(reactText(paragraph))
    for (const page of PAGES) expect(html).toContain(`id="${sectionId(page)}"`)
  })

  it('never uses a route as a DOM id', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    for (const id of ids) {
      expect(PAGES as readonly (string | undefined)[]).not.toContain(id)
      expect(id).toMatch(/^s-/)
    }
  })

  it('lists every tape as a "Play tape" link and every contact link', () => {
    for (const tape of TAPES) expect(html).toContain(`<a href="#work/${tape.id}">${reactText(`Play tape: ${tape.title}`)}</a>`)
    for (const link of LINKS) expect(html).toContain(`href="${link.href}"`)
    expect(html).toContain('rel="me noopener noreferrer"')
  })
})

describe('CV in the HTML layer', () => {
  const html = renderToStaticMarkup(createElement(SeoContent))
  const cvLinks = [...html.matchAll(/<a [^>]*href="https:\/\/rxresu\.me\/jeandv\/cv-jean-rondon"[^>]*>/g)].map((match) => match[0])

  it('links the CV from the hero, the Online section and the footer, always in a new tab', () => {
    expect(cvLinks).toHaveLength(3)
    for (const tag of cvLinks) {
      expect(tag).toContain(`href="${RESUME.url}"`)
      expect(tag).toContain('target="_blank"')
      expect(tag).toContain('rel="noopener noreferrer"')
    }
  })

  it('has a visible CV button right under the hero text, a row in Online and a footer line', () => {
    const hero = html.slice(html.indexOf('id="s-home"'), html.indexOf('id="s-about"'))
    expect(hero).toContain('class="seo-cv-link"')
    expect(hero).toMatch(/>CV<span aria-hidden="true"> ↗<\/span>/)
    const online = html.slice(html.indexOf('id="s-online"'), html.indexOf('id="s-credits"'))
    expect(online).toContain(`>${displayHref(RESUME.url)}</span>`)
    const footer = html.slice(html.indexOf('<footer'))
    expect(footer).toContain('Curriculum vitae')
    // The credits list stays above the footer.
    expect(html.indexOf('id="s-credits"')).toBeLessThan(html.indexOf('<footer'))
  })
})

describe('section focus requests', () => {
  it('expire unless consumed shortly after', () => {
    requestSectionFocus(1000)
    expect(takeSectionFocusRequest(1500)).toBe(true)
    expect(takeSectionFocusRequest(1600)).toBe(false)
    requestSectionFocus(1000)
    expect(takeSectionFocusRequest(9000)).toBe(false)
  })
})
