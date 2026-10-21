import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CREDITS } from '../content/credits'
import { ALL_CREDITS, CREDITS_EXTRA } from '../content/creditsExtra'
import { SeoContent } from '../seo/SeoContent'
import { isCanvasSafe } from './text'

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

  it('reaches the HTML layer', () => {
    const html = renderToStaticMarkup(createElement(SeoContent))
    for (const credit of CREDITS_EXTRA) expect(html).toContain(`<dt>${credit.role}</dt>`)
    expect(html).toContain('href="https://simpleicons.org"')
  })
})
