import { describe, expect, it } from 'vitest'
import { ALL_CREDITS } from '../content/creditsExtra'
import { PROFILE } from '../content/profile'
import { RESUME } from '../content/resume'
import { centredCardLayout, compactCardLayout } from '../three/camera/workLayout'
import {
  balancedLines,
  CARD_STYLE,
  colophonItems,
  COLOPHON_LEAD,
  CV_BUTTON_TEXT,
  CV_HINT,
  CV_TITLE,
  drawCvCard,
  GRIDS,
  layoutCvCard,
  packColophon,
  type CvCardContent,
} from './cvCard'
import { CARD_SIZE, COMPACT_CARD_SIZE, CV_BUTTON_ID, CV_BUTTONS, CV_SIZES, cvButtonUv, cvHits, type CvPrint } from './cvCardLayout'
import { FONT } from './fonts'
import { hitTest, uvToCanvas } from './hit'
import { isCanvasSafe, monoMeasure } from './text'

const PRINTS: readonly CvPrint[] = ['wide', 'compact']
const CONTENT: CvCardContent = { name: PROFILE.name, role: PROFILE.role, credits: ALL_CREDITS }

/** Lines of a print at a Courier-like advance of 0.6 em. */
const linesOf = (print: CvPrint) => layoutCvCard(print, (size) => monoMeasure(size * 0.6))

interface TextCall {
  readonly text: string
  readonly font: string
  readonly x: number
  readonly y: number
}

interface FillCall {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly style: string
}

/** A stand-in 2D context that records fills and text (Courier advance 0.6 em). */
class FakeContext {
  font = '10px sans-serif'
  fillStyle = ''
  strokeStyle = ''
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  textAlign = 'left'
  textBaseline = 'alphabetic'
  readonly texts: TextCall[] = []
  readonly fills: FillCall[] = []

  save(): void {}
  restore(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
  strokeRect(): void {}
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ x, y, w, h, style: String(this.fillStyle) })
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, font: this.font, x, y })
  }
  measureText(text: string): { width: number } {
    return { width: text.length * this.size() * 0.6 }
  }
  size(): number {
    return Number(/(\d+)px/.exec(this.font)?.[1] ?? 10)
  }
}

function draw(print: CvPrint, hover = false): FakeContext {
  const g = new FakeContext()
  drawCvCard(g as unknown as CanvasRenderingContext2D, CONTENT, print, hover)
  return g
}

describe('the CV link (src/content/resume.ts)', () => {
  it('points to the CV on Reactive Resume, as a short label and its host', () => {
    expect(RESUME).toEqual({ label: 'CV', url: 'https://rxresu.me/jeandv/cv-jean-rondon', host: 'rxresu.me' })
    expect(new URL(RESUME.url).host).toBe(RESUME.host)
  })
})

describe('CV card geometry', () => {
  it('has the two prints at the card sizes (5 × 3 in wide, the same upright on phones)', () => {
    expect(CV_SIZES.wide).toBe(CARD_SIZE)
    expect(CV_SIZES.compact).toBe(COMPACT_CARD_SIZE)
    expect(CARD_SIZE.width / CARD_SIZE.height).toBeCloseTo(5 / 3, 5)
    expect(COMPACT_CARD_SIZE.height / COMPACT_CARD_SIZE.width).toBeCloseTo(5 / 3, 5)
  })

  it.each(PRINTS)('%s: OPEN CV is the card\'s only hit rect, big, inside the card and clear of the text', (print) => {
    const rect = CV_BUTTONS[print]
    const { width, height } = CV_SIZES[print]
    const grid = GRIDS[print]
    expect(cvHits(print)).toEqual([rect])
    expect(rect).toMatchObject({ id: CV_BUTTON_ID, label: 'OPEN CV' })
    expect(rect.w).toBeGreaterThanOrEqual(width / 2)
    expect(rect.h).toBeGreaterThanOrEqual(height / 10)
    expect(rect.x).toBeGreaterThanOrEqual(24)
    expect(rect.x + rect.w).toBeLessThanOrEqual(width - 24)
    // Below the hint's last line, above the divider of the colophon.
    const hintLines = linesOf(print).hint.length
    expect(rect.y).toBeGreaterThan(grid.hint.base + (hintLines - 1) * grid.hint.pitch + 8)
    expect(rect.y + rect.h).toBeLessThan(grid.divider)
  })

  it.each(PRINTS)('%s: the button is hit at its centre and not just outside it', (print) => {
    const rect = CV_BUTTONS[print]
    const rects = cvHits(print)
    expect(hitTest(rects, rect.x + rect.w / 2, rect.y + rect.h / 2)?.id).toBe(CV_BUTTON_ID)
    expect(hitTest(rects, rect.x, rect.y)?.id).toBe(CV_BUTTON_ID)
    expect(hitTest(rects, rect.x - 1, rect.y + rect.h / 2)).toBeNull()
    expect(hitTest(rects, rect.x + rect.w, rect.y + rect.h / 2)).toBeNull()
    expect(hitTest(rects, rect.x + rect.w / 2, rect.y + rect.h)).toBeNull()
    expect(hitTest(rects, 10, 10)).toBeNull()
  })

  it.each(PRINTS)('%s: the button centre round-trips through the plane UV the pointer reports', (print) => {
    const { u, v } = cvButtonUv(print)
    const { width, height } = CV_SIZES[print]
    // Three-native plane UVs: v up, so the canvas row is flipped.
    const point = uvToCanvas({ x: u, y: v }, width, height, true)
    const rect = CV_BUTTONS[print]
    expect(point.x).toBeCloseTo(rect.x + rect.w / 2, 6)
    expect(point.y).toBeCloseTo(rect.y + rect.h / 2, 6)
    expect(hitTest(cvHits(print), point.x, point.y)?.id).toBe(CV_BUTTON_ID)
  })
})

describe('CV card text', () => {
  it('prints only what the card font has', () => {
    for (const text of [PROFILE.name.toUpperCase(), PROFILE.role, CV_TITLE, CV_HINT, CV_BUTTON_TEXT, COLOPHON_LEAD, ...colophonItems()]) {
      expect(isCanvasSafe(text), text).toBe(true)
    }
  })

  it('wraps the hint to one line on the wide card and two even lines at most on the phone card', () => {
    expect(linesOf('wide').hint).toEqual([CV_HINT])
    const phone = linesOf('compact').hint
    expect(phone.join(' ')).toBe(CV_HINT)
    expect(phone.length).toBeLessThanOrEqual(2)
    // No one-word orphan on the second line.
    expect(phone.at(-1)?.split(' ').length).toBeGreaterThan(1)
  })

  it('evens out the lines of a wrapped text without adding one', () => {
    const measure = monoMeasure(1)
    expect(balancedLines('aaaa bbbb cccc dd', 14, measure)).toEqual(['aaaa bbbb', 'cccc dd'])
    expect(balancedLines('aaaa bbbb', 14, measure)).toEqual(['aaaa bbbb'])
    expect(balancedLines('', 14, measure)).toEqual([''])
  })

  it('the colophon names the inspiration, the music, the fonts, the icons and the landmark', () => {
    const colophon = colophonItems().join(' | ')
    for (const part of ['Felix Rieseberg', 'Joji', '88rising', 'YouTube', 'SIL OFL', 'Simple Icons', 'CC0', 'Obelisco de Barquisimeto']) {
      expect(colophon).toContain(part)
    }
  })

  it('packs the colophon into whole items, the first line shortened by the lead', () => {
    const measure = monoMeasure(1)
    expect(packColophon(['aaaa', 'bbbb', 'cccc'], 10, 10, measure)).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(packColophon(['aaaa', 'bbbb', 'cccc'], 11, 11, measure)).toEqual(['aaaa · bbbb', 'cccc'])
    expect(packColophon(['aaaa', 'bbbb', 'cccc'], 6, 20, measure)).toEqual(['aaaa', 'bbbb · cccc'])
    expect(packColophon([], 6, 20, measure)).toEqual([])
  })

  it('the colophon is one or two lines on the wide card and fits the width', () => {
    const { colophon, lead } = linesOf('wide')
    const grid = GRIDS.wide
    expect(colophon.length).toBeGreaterThanOrEqual(1)
    expect(colophon.length).toBeLessThanOrEqual(2)
    const measure = monoMeasure(grid.colophon.size * 0.6)
    colophon.forEach((line, i) => expect(measure(line) + (i === 0 ? lead : 0)).toBeLessThanOrEqual(grid.right - grid.left))
  })

  it.each(PRINTS)('%s: the small print stays inside the card', (print) => {
    const grid = GRIDS[print]
    const { colophon } = linesOf(print)
    const last = grid.colophon.base + (colophon.length - 1) * grid.colophon.pitch
    expect(last + grid.colophon.size * 0.3).toBeLessThanOrEqual(CV_SIZES[print].height - 12)
  })
})

describe('CV card on screen', () => {
  it('reads at ≥ 12 CSS px even in the small print, on the 1280 × 720 desktop frame', () => {
    const aspect = 1280 / 720
    const cardAspect = CARD_SIZE.width / CARD_SIZE.height
    const { heightFrac } = centredCardLayout(aspect, cardAspect)
    const scale = (heightFrac * 720 * cardAspect) / CARD_SIZE.width
    expect(GRIDS.wide.colophon.size * scale).toBeGreaterThanOrEqual(12)
    expect(GRIDS.wide.hint.size * scale).toBeGreaterThanOrEqual(16)
    expect(CV_BUTTONS.wide.h * scale).toBeGreaterThanOrEqual(44)
  })

  it('reads at ≥ 12 CSS px and keeps a thumb-sized button on a 390 × 844 phone (≤ 420 px)', () => {
    const aspect = 390 / 844
    const cardAspect = COMPACT_CARD_SIZE.width / COMPACT_CARD_SIZE.height
    const { heightFrac } = compactCardLayout(aspect, cardAspect)
    const cardWidth = heightFrac * 844 * cardAspect
    expect(cardWidth / 390).toBeGreaterThan(0.85)
    expect(cardWidth / 390).toBeLessThanOrEqual(0.94 + 1e-9)
    const scale = cardWidth / COMPACT_CARD_SIZE.width
    expect(GRIDS.compact.colophon.size * scale).toBeGreaterThanOrEqual(12)
    expect(GRIDS.compact.hint.size * scale).toBeGreaterThanOrEqual(16)
    expect(CV_BUTTONS.compact.h * scale).toBeGreaterThanOrEqual(44)
  })
})

describe('drawing the CV card', () => {
  it.each(PRINTS)('%s: draws the name, role, title, hint, OPEN CV and the credits line, all in Courier Prime', (print) => {
    const { texts } = draw(print)
    const drawn = texts.map((call) => call.text)
    expect(drawn).toContain(PROFILE.name.toUpperCase())
    expect(drawn).toContain(PROFILE.role)
    expect(drawn).toContain(CV_TITLE)
    expect(drawn).toContain(CV_BUTTON_TEXT)
    expect(drawn).toContain(COLOPHON_LEAD)
    expect(drawn.filter((text) => linesOf(print).hint.includes(text))).toEqual(linesOf(print).hint)
    for (const line of linesOf(print).colophon) expect(drawn).toContain(line)
    for (const call of texts) expect(call.font, call.text).toContain(FONT.card)
  })

  it.each(PRINTS)('%s: the OPEN CV label sits inside its hit rect and every text stays on the card', (print) => {
    const { texts } = draw(print)
    const rect = CV_BUTTONS[print]
    const label = texts.find((call) => call.text === CV_BUTTON_TEXT)
    expect(label).toBeDefined()
    if (!label) return
    expect(label.x).toBeGreaterThan(rect.x)
    expect(label.y).toBeGreaterThan(rect.y)
    expect(label.y).toBeLessThan(rect.y + rect.h)
    const { width, height } = CV_SIZES[print]
    for (const call of texts) {
      const size = Number(/(\d+)px/.exec(call.font)?.[1])
      expect(call.x).toBeGreaterThanOrEqual(0)
      expect(call.x + call.text.length * size * 0.6, call.text).toBeLessThanOrEqual(width - 24)
      expect(call.y).toBeLessThan(height)
    }
  })

  it.each(PRINTS)('%s: the button is ink, and red while the pointer is on it', (print) => {
    const rect = CV_BUTTONS[print]
    const fillOf = (hover: boolean) =>
      draw(print, hover).fills.find((fill) => fill.x === rect.x && fill.y === rect.y && fill.w === rect.w && fill.h === rect.h)
    expect(fillOf(false)?.style).toBe(CARD_STYLE.ink)
    expect(fillOf(true)?.style).toBe(CARD_STYLE.head)
  })
})
