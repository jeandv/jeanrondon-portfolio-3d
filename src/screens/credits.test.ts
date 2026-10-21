import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CREDITS } from '../content/credits'
import { PROFILE } from '../content/profile'
import { SeoContent } from '../seo/SeoContent'
import { FONT, SCREEN_FACES } from './fonts'
import { isCanvasSafe } from './text'

const byRole = (role: string) => CREDITS.find((credit) => credit.role === role)

describe('credits content', () => {
  it('credits the author from the profile, the inspiration, the 3D, type, tools and sound', () => {
    expect(byRole('Design & code')?.text).toBe(PROFILE.name)
    expect(byRole('Inspiration')?.text).toContain('felixrieseberg.com')
    expect(byRole('3D')?.text).toMatch(/greybox/i)
    for (const face of ['Archivo', 'VT323', 'Caveat', 'JetBrains Mono', 'Courier Prime', 'SIL OFL']) {
      expect(byRole('Type')?.text).toContain(face)
    }
    for (const tool of ['React Three Fiber', 'three.js', 'drei', 'postprocessing', 'Vite']) {
      expect(byRole('Built with')?.text).toContain(tool)
    }
    expect(byRole('Sound')?.text).toMatch(/Web Audio API/)
  })

  it('has unique roles, non-empty text, https links and only characters the card font has', () => {
    expect(new Set(CREDITS.map((credit) => credit.role)).size).toBe(CREDITS.length)
    for (const credit of CREDITS) {
      expect(credit.role.trim()).not.toBe('')
      expect(credit.text.trim()).not.toBe('')
      if (credit.href !== undefined) expect(credit.href).toMatch(/^https:\/\//)
      expect(isCanvasSafe(credit.role) && isCanvasSafe(credit.text), credit.text).toBe(true)
    }
  })

  it('Courier Prime is part of the font gate (the card never draws a fallback face)', () => {
    expect(SCREEN_FACES).toContain(`400 32px ${FONT.card}`)
    expect(SCREEN_FACES).toContain(`700 32px ${FONT.card}`)
  })
})

describe('credits in the HTML layer (the footer keeps the full list)', () => {
  it('prerenders a Credits section from the same data', () => {
    const html = renderToStaticMarkup(createElement(SeoContent))
    expect(html).toContain('id="s-credits"')
    expect(html).toContain('>Credits</h2>')
    for (const credit of CREDITS) expect(html).toContain(`<dt>${credit.role.replace('&', '&amp;')}</dt>`)
    expect(html).toContain('href="https://felixrieseberg.com"')
  })
})
