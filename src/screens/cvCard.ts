import type { Credit } from '../content/credits'
import { CV_BUTTONS, CV_SIZES, type CvPrint } from './cvCardLayout'
import { font, FONT } from './fonts'
import type { HitRect } from './hit'
import { canvasMeasure, fitSize, wrapText, type Measure } from './text'

/**
 * The CV index card (5 × 3 in, Courier Prime, drawn once into a CanvasTexture):
 * a red head rule over blue ruled lines with the name and role, CURRICULUM
 * VITAE, a one-line hint, a big boxed OPEN CV button (a hit rect, see
 * cvCardLayout.ts) and, as small print at the bottom, "Credits:" with a
 * compact colophon of the full list (which stays in the HTML footer).
 *
 * Two prints: the wide card, and the same card held upright on phones
 * (≤ 420 CSS px wide) in larger type.
 */

export const CARD_STYLE = {
  paper: '#f4eedc',
  edge: '#e2d8bd',
  rule: '#a9c8e4',
  head: '#d9655c',
  ink: '#23222b',
  role: '#8a3a2a',
} as const

export const CV_TITLE = 'Check my CV!!'
export const CV_HINT = ''
export const CV_BUTTON_TEXT = 'OPEN CV'
export const COLOPHON_LEAD = 'Contact info:'
const SEPARATOR = ' · '

/** What the card prints about its owner and which credits the colophon draws from. */
export interface CvCardContent {
  /** Drawn upper-case. */
  readonly name: string
  readonly role: string
  readonly credits: readonly Credit[]
}

/**
 * The colophon: a short form of the credits worth a line of small print, each
 * only while its role is still in the list (the full text stays in the HTML
 * footer).
 */
const COLOPHON: readonly { readonly role: string; readonly text: string }[] = [
  { role: 'email', text: 'jeanrdev@gmail.com' },
  { role: 'phone', text: '+584122901679' },
  { role: 'linkedin', text: 'linkedin.com/in/jeanrondon' },
  { role: 'github', text: 'github.com/jeandv' },
]

/** The colophon's items, in order, for the credits given. */
export function colophonItems(): string[] {
  return COLOPHON.map((item) => item.text)
}

/**
 * Packs the colophon's items into lines (greedy; an item is never split, a
 * line break stands in for the separator). The first line is `firstWidth` wide
 * (the "Credits:" lead takes the rest), the others `width`.
 */
export function packColophon(items: readonly string[], firstWidth: number, width: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  for (const item of items) {
    const limit = lines.length === 0 ? firstWidth : width
    const candidate = line ? `${line}${SEPARATOR}${item}` : item
    if (line && measure(candidate) > limit) {
      lines.push(line)
      line = item
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Where everything of a print sits (canvas px; text baselines, sizes). */
interface Grid {
  /** Left and right edge of the text area. */
  readonly left: number
  readonly right: number
  /** The red rule under the name, then the blue ruled lines (first, last, pitch). */
  readonly headRule: number
  readonly firstRule: number
  readonly lastRule: number
  readonly pitch: number
  readonly name: { readonly size: number; readonly base: number }
  readonly role: { readonly size: number; readonly base: number }
  readonly title: { readonly size: number; readonly base: number }
  /** `base` is the first line's baseline. */
  readonly hint: { readonly size: number; readonly base: number; readonly pitch: number }
  /** Size of the OPEN CV label. */
  readonly label: number
  /** The line above the colophon. */
  readonly divider: number
  readonly colophon: { readonly size: number; readonly base: number; readonly pitch: number }
}

export const GRIDS: Readonly<Record<CvPrint, Grid>> = {
  wide: {
    left: 56,
    right: 944,
    headRule: 150,
    firstRule: 190,
    lastRule: 430,
    pitch: 40,
    name: { size: 60, base: 84 },
    role: { size: 26, base: 128 },
    title: { size: 44, base: 222 },
    hint: { size: 24, base: 262, pitch: 30 },
    label: 56,
    divider: 466,
    colophon: { size: 17, base: 508, pitch: 26 },
  },
  compact: {
    left: 44,
    right: 556,
    headRule: 176,
    firstRule: 220,
    lastRule: 704,
    pitch: 44,
    name: { size: 54, base: 96 },
    role: { size: 28, base: 142 },
    title: { size: 44, base: 256 },
    hint: { size: 30, base: 300, pitch: 44 },
    label: 58,
    divider: 748,
    colophon: { size: 22, base: 796, pitch: 32 },
  },
}

/** The text lines of a print that depend on measuring (pure; `measureAt(size)` returns the measure at that size). */
export interface CvCardLines {
  readonly hint: readonly string[]
  /** Colophon lines; the first continues the "Credits:" lead. */
  readonly colophon: readonly string[]
  /** Width (px) the "Credits:" lead takes, with its trailing space. */
  readonly lead: number
}

/** Word wrap with the lines evened out: the narrowest width that still gives the same number of lines (no one-word last line). */
export function balancedLines(text: string, width: number, measure: Measure): string[] {
  const lines = wrapText(text, width, measure)
  if (lines.length < 2) return lines
  let low = 1
  let high = width
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (wrapText(text, mid, measure).length <= lines.length) high = mid
    else low = mid + 1
  }
  return wrapText(text, high, measure)
}

export function layoutCvCard(print: CvPrint, measureAt: (size: number) => Measure): CvCardLines {
  const grid = GRIDS[print]
  const width = grid.right - grid.left
  const hint = balancedLines(CV_HINT, width, measureAt(grid.hint.size))
  const small = measureAt(grid.colophon.size)
  const lead = small(`${COLOPHON_LEAD} `)
  return { hint, colophon: packColophon(colophonItems(), width - lead, width, small), lead }
}

/** Paper speckles at fixed spots (deterministic hash, so redraws never shimmer). */
function speckles(g: CanvasRenderingContext2D, width: number, height: number): void {
  g.fillStyle = 'rgba(120, 100, 60, 0.07)'
  for (let i = 0; i < 260; i++) {
    const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1
    const y = ((Math.sin(i * 78.233) * 12543.123) % 1 + 1) % 1
    g.fillRect(x * width, y * height, 2, 2)
  }
}

/** An up-and-right arrow drawn with strokes (Courier Prime has no U+2197). */
function arrow(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const h = size / 2
  g.strokeStyle = color
  g.lineWidth = Math.max(4, size * 0.2)
  g.lineCap = 'butt'
  g.lineJoin = 'miter'
  g.beginPath()
  g.moveTo(cx - h, cy + h)
  g.lineTo(cx + h, cy - h)
  g.stroke()
  g.beginPath()
  g.moveTo(cx - h * 0.3, cy - h)
  g.lineTo(cx + h, cy - h)
  g.lineTo(cx + h, cy + h * 0.3)
  g.stroke()
}

/** The boxed OPEN CV button: ink with a paper label, red under the pointer. */
function drawButton(g: CanvasRenderingContext2D, rect: HitRect, labelSize: number, hover: boolean): void {
  const lift = Math.round(rect.h * 0.08)
  g.fillStyle = 'rgba(35, 34, 43, 0.22)'
  g.fillRect(rect.x + lift, rect.y + lift, rect.w, rect.h)
  g.fillStyle = hover ? CARD_STYLE.head : CARD_STYLE.ink
  g.fillRect(rect.x, rect.y, rect.w, rect.h)
  const label = hover ? CARD_STYLE.ink : CARD_STYLE.paper
  g.strokeStyle = label
  g.lineWidth = 3
  g.strokeRect(rect.x + 9, rect.y + 9, rect.w - 18, rect.h - 18)

  g.font = font(700, labelSize, FONT.card)
  const textWidth = g.measureText(CV_BUTTON_TEXT).width
  const arrowSize = labelSize * 0.62
  const gap = labelSize * 0.4
  const start = rect.x + (rect.w - (textWidth + gap + arrowSize)) / 2
  const middle = rect.y + rect.h / 2
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = label
  g.fillText(CV_BUTTON_TEXT, start, middle + labelSize * 0.3)
  arrow(g, start + textWidth + gap + arrowSize / 2, middle, arrowSize, label)
}

function put(g: CanvasRenderingContext2D, text: string, x: number, y: number, weight: number, size: number, color: string): void {
  g.font = font(weight, size, FONT.card)
  g.fillStyle = color
  g.fillText(text, x, y)
}

/** Largest size (down to `min`) at which `text` fits `width` in bold or regular Courier Prime. */
function fitted(g: CanvasRenderingContext2D, text: string, width: number, max: number, min: number, weight: number): number {
  return fitSize(width, max, min, (size) => {
    g.font = font(weight, size, FONT.card)
    return g.measureText(text).width
  })
}

/** Draws one print of the card; `hover` lights the OPEN CV button. */
export function drawCvCard(g: CanvasRenderingContext2D, content: CvCardContent, print: CvPrint, hover = false): void {
  const grid = GRIDS[print]
  const { width: W, height: H } = CV_SIZES[print]
  const textWidth = grid.right - grid.left

  g.save()
  g.fillStyle = CARD_STYLE.paper
  g.fillRect(0, 0, W, H)
  speckles(g, W, H)
  g.strokeStyle = CARD_STYLE.edge
  g.lineWidth = 6
  g.strokeRect(3, 3, W - 6, H - 6)

  // Ruled lines down to the colophon, then the red head rule.
  g.fillStyle = CARD_STYLE.rule
  for (let y = grid.firstRule; y <= grid.lastRule; y += grid.pitch) g.fillRect(24, y, W - 48, 2)
  g.fillRect(24, grid.divider, W - 48, 3)
  g.fillStyle = CARD_STYLE.head
  g.fillRect(24, grid.headRule, W - 48, 3)

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  const name = content.name.toUpperCase()
  put(g, name, grid.left, grid.name.base, 700, fitted(g, name, textWidth, grid.name.size, 28, 700), CARD_STYLE.ink)
  put(g, content.role, grid.left, grid.role.base, 400, fitted(g, content.role, textWidth, grid.role.size, 16, 400), CARD_STYLE.role)
  put(g, CV_TITLE, grid.left, grid.title.base, 700, grid.title.size, CARD_STYLE.ink)

  const lines = layoutCvCard(print, (size) => {
    g.font = font(400, size, FONT.card)
    return canvasMeasure(g)
  })
  lines.hint.forEach((line, i) => put(g, line, grid.left, grid.hint.base + i * grid.hint.pitch, 400, grid.hint.size, CARD_STYLE.ink))

  drawButton(g, CV_BUTTONS[print], grid.label, hover)

  // Small print: the lead in the role colour, the colophon after it and below.
  const { size, base, pitch } = grid.colophon
  lines.colophon.forEach((line, i) => {
    if (i === 0) {
      put(g, COLOPHON_LEAD, grid.left, base, 700, size, CARD_STYLE.role)
      put(g, line, grid.left + lines.lead, base, 400, size, CARD_STYLE.ink)
    } else {
      put(g, line, grid.left, base + i * pitch, 400, size, CARD_STYLE.ink)
    }
  })
  g.restore()
}
