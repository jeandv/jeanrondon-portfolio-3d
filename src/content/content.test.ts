import { describe, expect, it } from 'vitest'
import { parseHash } from '../state/router'
import { displayHref, LINKS } from './links'
import { PROFILE } from './profile'
import { SITE } from './site'
import { TAPE_IDS, TAPES, tapeBySlot } from './work'

describe('work content', () => {
  it('has at most 8 tapes with unique ids', () => {
    expect(TAPES.length).toBeLessThanOrEqual(8)
    expect(TAPE_IDS.size).toBe(TAPES.length)
  })

  it('uses unique shelf slots between 1 and 8', () => {
    const slots = TAPES.map((tape) => tape.slot)
    expect(new Set(slots).size).toBe(slots.length)
    for (const slot of slots) {
      expect(Number.isInteger(slot) && slot >= 1 && slot <= 8).toBe(true)
      expect(tapeBySlot(slot)?.slot).toBe(slot)
    }
  })

  it('ids survive the #work/<id> route', () => {
    for (const tape of TAPES) {
      expect(parseHash(`#work/${tape.id}`, TAPE_IDS)).toEqual({ page: 'work', tape: tape.id })
    }
  })

  it('fills the required fields', () => {
    for (const tape of TAPES) {
      expect(tape.title.trim()).not.toBe('')
      expect(tape.years.trim()).not.toBe('')
      expect(tape.role.trim()).not.toBe('')
      expect(tape.bullets.length).toBeGreaterThan(0)
      expect(tape.stack.length).toBeGreaterThan(0)
    }
  })

  it('only links tapes to https URLs', () => {
    for (const tape of TAPES) {
      if (tape.url !== undefined) expect(tape.url).toMatch(/^https:\/\//)
    }
  })
})

describe('canvas-safe text', () => {
  // Printable ASCII, Latin-1 and common punctuation: verified present in the
  // latin subsets of VT323, Caveat, JetBrains Mono and Archivo, so the screens
  // never fall back to another font. Extend only after checking the font files.
  const SAFE = /^[\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]*$/

  it('only uses characters the screen fonts contain', () => {
    const drawn = [
      PROFILE.name,
      PROFILE.role,
      PROFILE.location,
      ...PROFILE.bio,
      ...LINKS.flatMap((link) => [link.label, displayHref(link.href)]),
      ...TAPES.flatMap((tape) => [tape.title, tape.years, tape.role, tape.summary, ...tape.bullets, ...tape.stack]),
    ]
    for (const text of drawn) expect(text, text).toMatch(SAFE)
  })
})

describe('profile, links and site meta', () => {
  it('has a name, a role and at least one bio paragraph', () => {
    expect(PROFILE.name.trim()).not.toBe('')
    expect(PROFILE.role.trim()).not.toBe('')
    expect(PROFILE.bio.length).toBeGreaterThan(0)
  })

  it('has unique contact links that are mailto: or https:', () => {
    expect(new Set(LINKS.map((link) => link.id)).size).toBe(LINKS.length)
    for (const link of LINKS) expect(link.href).toMatch(/^(mailto:|https:\/\/)/)
  })

  it('shortens hrefs for display', () => {
    expect(displayHref('mailto:jeanrdev@gmail.com')).toBe('jeanrdev@gmail.com')
    expect(displayHref('https://www.linkedin.com/in/jeanrondon/')).toBe('linkedin.com/in/jeanrondon')
  })

  it('has an absolute https site URL and an OG image path', () => {
    expect(SITE.url).toMatch(/^https:\/\//)
    expect(SITE.ogImage.startsWith('/')).toBe(true)
  })
})
