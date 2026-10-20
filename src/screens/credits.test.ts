import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CREDITS } from '../content/credits'
import { PROFILE } from '../content/profile'
import { SeoContent } from '../seo/SeoContent'
import { compactCardLayout } from '../three/camera/workLayout'
import { CARD_GRID, COMPACT_CARD_SIZE, COMPACT_GRID, COMPACT_TEXT, compactRows, layoutCompact, layoutCredits, layoutRows, ruledLines } from './creditsCard'
import { FONT, SCREEN_FACES } from './fonts'
import { isCanvasSafe, monoMeasure } from './text'

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

describe('credits card layout', () => {
  it('fits every credit on the ruled lines at the full size (Courier advance 0.6 em)', () => {
    const measure = monoMeasure(26 * 0.6)
    const entries = layoutCredits(CREDITS, CARD_GRID.right - CARD_GRID.textLeft, measure)
    expect(entries.map((entry) => entry.role)).toEqual(CREDITS.map((credit) => credit.role.toUpperCase()))
    expect(layoutRows(entries)).toBeLessThanOrEqual(ruledLines())
    for (const entry of entries) {
      for (const line of entry.lines) expect(measure(line)).toBeLessThanOrEqual(CARD_GRID.right - CARD_GRID.textLeft)
    }
  })
})

describe('credits card on phones (≤ 420 px)', () => {
  /** Largest text size (Courier advance 0.6 em) at which the compact card fits every credit. */
  function compactSize(): number {
    for (let size = COMPACT_TEXT.max; size > COMPACT_TEXT.min; size--) {
      if (compactRows(layoutCompact(CREDITS, monoMeasure(size * 0.6))) <= ruledLines(COMPACT_GRID)) return size
    }
    return COMPACT_TEXT.min
  }

  it('fits every credit, one column, in large type', () => {
    const size = compactSize()
    const entries = layoutCompact(CREDITS, monoMeasure(size * 0.6))
    expect(compactRows(entries)).toBeLessThanOrEqual(ruledLines(COMPACT_GRID))
    expect(size).toBeGreaterThanOrEqual(30)
  })

  it('reads at ≥ 16 CSS px on a 390 × 844 phone (≈ 9 px on the wide card before)', () => {
    const aspect = 390 / 844
    const cardAspect = COMPACT_CARD_SIZE.width / COMPACT_CARD_SIZE.height
    const { heightFrac } = compactCardLayout(aspect, cardAspect)
    const cardCssWidth = heightFrac * 844 * cardAspect
    expect(cardCssWidth / 390).toBeGreaterThan(0.85)
    expect(cardCssWidth / 390).toBeLessThanOrEqual(0.94 + 1e-9)
    expect(compactSize() * (cardCssWidth / COMPACT_CARD_SIZE.width)).toBeGreaterThan(16)
  })
})

describe('credits in the HTML layer', () => {
  it('prerenders a Credits section from the same data', () => {
    const html = renderToStaticMarkup(createElement(SeoContent))
    expect(html).toContain('id="s-credits"')
    expect(html).toContain('>Credits</h2>')
    for (const credit of CREDITS) expect(html).toContain(`<dt>${credit.role.replace('&', '&amp;')}</dt>`)
    expect(html).toContain('href="https://felixrieseberg.com"')
  })
})
