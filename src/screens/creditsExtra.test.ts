import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CREDITS } from '../content/credits'
import { ALL_CREDITS, CREDITS_EXTRA } from '../content/creditsExtra'
import { SeoContent } from '../seo/SeoContent'
import { CARD_GRID, COMPACT_GRID, COMPACT_TEXT, compactPitch, compactRows, layoutCompact, layoutCredits, layoutRows, ruledLines } from './creditsCard'
import { isCanvasSafe, monoMeasure } from './text'

describe('phase 3 credits (creditsExtra.ts, merged after credits.ts)', () => {
  it('credits the Joji streams, the posters, the icons and the landmark', () => {
    const text = (role: string) => CREDITS_EXTRA.find((credit) => credit.role === role)?.text ?? ''
    expect(text('Music')).toBe("Joji — streamed from 88rising's official YouTube videos")
    expect(text('Posters')).toBe('Original fan tributes; names belong to their owners')
    expect(text('Icons')).toBe('Simple Icons (CC0)')
    expect(text('Landmark')).toBe('Obelisco de Barquisimeto')
    expect(ALL_CREDITS.slice(0, CREDITS.length)).toEqual(CREDITS)
  })

  it('keeps roles unique, text canvas-safe and links https', () => {
    expect(new Set(ALL_CREDITS.map((credit) => credit.role)).size).toBe(ALL_CREDITS.length)
    for (const credit of CREDITS_EXTRA) {
      expect(isCanvasSafe(credit.role) && isCanvasSafe(credit.text), credit.text).toBe(true)
      if (credit.href !== undefined) expect(credit.href).toMatch(/^https:\/\//)
    }
  })

  it('still fits the index card (the text shrinks to 16 px at most)', () => {
    const size = 18
    const entries = layoutCredits(ALL_CREDITS, CARD_GRID.right - CARD_GRID.textLeft, monoMeasure(size * 0.6))
    expect(layoutRows(entries)).toBeLessThanOrEqual(ruledLines())
  })

  it('fits the phone card too, closing up the rules when the smallest text needs more of them', () => {
    const entries = layoutCompact(ALL_CREDITS, monoMeasure(COMPACT_TEXT.min * 0.6))
    const rows = compactRows(entries)
    const pitch = compactPitch(rows)
    expect(COMPACT_GRID.firstRule + (rows - 1) * pitch).toBeLessThanOrEqual(COMPACT_GRID.lastRule)
    // Still room for a 22 px line on each rule.
    expect(pitch).toBeGreaterThanOrEqual(COMPACT_TEXT.min + 6)
    expect(compactPitch(3)).toBe(COMPACT_GRID.pitch)
  })

  it('reaches the HTML layer', () => {
    const html = renderToStaticMarkup(createElement(SeoContent))
    for (const credit of CREDITS_EXTRA) expect(html).toContain(`<dt>${credit.role}</dt>`)
    expect(html).toContain('href="https://simpleicons.org"')
  })
})
