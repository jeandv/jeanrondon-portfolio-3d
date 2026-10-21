import type { Credit } from '../content/credits'
import { font, FONT } from './fonts'
import { canvasMeasure, wrapText, type Measure } from './text'

/**
 * The credits index card (5 × 3 in, Courier Prime): a red head rule, blue
 * ruled lines, each credit's role in the left column and its text wrapped
 * on the rules to the right. Drawn once into a CanvasTexture.
 */

export const CARD_SIZE = { width: 1000, height: 600 } as const

/**
 * Phones (≤ 420 CSS px wide): the same card held upright, one column (each
 * role above its text) in much larger type, so it reads at ~19 px instead of ~9.
 */
export const COMPACT_CARD_SIZE = { width: 600, height: 1000 } as const

export const COMPACT_GRID = {
  left: 44,
  right: 556,
  headRule: 112,
  firstRule: 172,
  lastRule: 952,
  pitch: 40,
} as const

/** Largest and smallest text size (px) of the compact card. */
export const COMPACT_TEXT = { max: 34, min: 22 } as const

export const CARD_STYLE = {
  paper: '#f4eedc',
  edge: '#e2d8bd',
  rule: '#a9c8e4',
  head: '#d9655c',
  ink: '#23222b',
  role: '#8a3a2a',
} as const

/** Left edge and width of the two columns, the ruled area and the line pitch (canvas px). */
export const CARD_GRID = {
  left: 56,
  textLeft: 300,
  right: 952,
  headRule: 100,
  firstRule: 146,
  lastRule: 574,
  pitch: 36,
} as const

export interface CardEntry {
  readonly role: string
  readonly lines: readonly string[]
}

/** Text lines per credit for a text column `width` px wide (pure; measure injected). */
export function layoutCredits(credits: readonly Credit[], width: number, measure: Measure): CardEntry[] {
  return credits.map((credit) => ({ role: credit.role.toUpperCase(), lines: wrapText(credit.text, width, measure) }))
}

/** Ruled lines available on the card. */
export function ruledLines(grid: { readonly firstRule: number; readonly lastRule: number; readonly pitch: number } = CARD_GRID): number {
  return Math.floor((grid.lastRule - grid.firstRule) / grid.pitch) + 1
}

/** Rows the layout takes (each credit starts on the next rule; its role heads the first). */
export function layoutRows(entries: readonly CardEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.lines.length, 0)
}

/** Rows of the compact layout: each role takes a rule of its own above its text. */
export function compactRows(entries: readonly CardEntry[]): number {
  return entries.reduce((sum, entry) => sum + 1 + entry.lines.length, 0)
}

/**
 * Line pitch (px) of the compact card for `rows` rows: the grid's own pitch,
 * or tighter when even the smallest text needs more rules than it has.
 */
export function compactPitch(rows: number, grid: { readonly firstRule: number; readonly lastRule: number; readonly pitch: number } = COMPACT_GRID): number {
  if (rows <= ruledLines(grid)) return grid.pitch
  return Math.floor((grid.lastRule - grid.firstRule) / Math.max(1, rows - 1))
}

/** Text lines per credit for the compact card's single column (pure; measure injected). */
export function layoutCompact(credits: readonly Credit[], measure: Measure, grid = COMPACT_GRID): CardEntry[] {
  return layoutCredits(credits, grid.right - grid.left, measure)
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

export function drawCreditsCard(g: CanvasRenderingContext2D, credits: readonly Credit[], width = CARD_SIZE.width, height = CARD_SIZE.height): void {
  const sx = width / CARD_SIZE.width
  const sy = height / CARD_SIZE.height
  g.save()
  g.scale(sx, sy)
  const W = CARD_SIZE.width
  const H = CARD_SIZE.height
  const grid = CARD_GRID

  g.fillStyle = CARD_STYLE.paper
  g.fillRect(0, 0, W, H)
  speckles(g, W, H)
  g.strokeStyle = CARD_STYLE.edge
  g.lineWidth = 6
  g.strokeRect(3, 3, W - 6, H - 6)

  // Ruled lines, then the red head rule.
  g.fillStyle = CARD_STYLE.rule
  for (let y = grid.firstRule; y <= grid.lastRule; y += grid.pitch) g.fillRect(24, y, W - 48, 2)
  g.fillStyle = CARD_STYLE.head
  g.fillRect(24, grid.headRule, W - 48, 3)

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = CARD_STYLE.ink
  g.font = font(700, 50, FONT.card)
  g.fillText('CREDITS', grid.left, grid.headRule - 26)
  g.font = font(400, 22, FONT.card)
  g.textAlign = 'right'
  g.fillStyle = CARD_STYLE.role
  g.fillText('jean-net / file 1 of 1', grid.right, grid.headRule - 30)
  g.textAlign = 'left'

  // Shrink the text until every credit fits the ruled lines.
  let size = 26
  let entries: CardEntry[] = []
  for (; size >= 16; size--) {
    g.font = font(400, size, FONT.card)
    entries = layoutCredits(credits, grid.right - grid.textLeft, canvasMeasure(g))
    if (layoutRows(entries) <= ruledLines()) break
  }

  const baseline = (r: number) => grid.firstRule + r * grid.pitch - 8
  let row = 0
  for (const entry of entries) {
    g.font = font(700, Math.min(20, size - 4), FONT.card)
    g.fillStyle = CARD_STYLE.role
    g.fillText(entry.role, grid.left, baseline(row))
    g.font = font(400, size, FONT.card)
    g.fillStyle = CARD_STYLE.ink
    for (const line of entry.lines) {
      g.fillText(line, grid.textLeft, baseline(row))
      row++
    }
  }
  g.restore()
}

/** The compact (upright, phone) card: one column, each role on its own rule above its text. */
export function drawCreditsCardCompact(
  g: CanvasRenderingContext2D,
  credits: readonly Credit[],
  width = COMPACT_CARD_SIZE.width,
  height = COMPACT_CARD_SIZE.height,
): void {
  g.save()
  g.scale(width / COMPACT_CARD_SIZE.width, height / COMPACT_CARD_SIZE.height)
  const W = COMPACT_CARD_SIZE.width
  const H = COMPACT_CARD_SIZE.height
  const grid = COMPACT_GRID

  g.fillStyle = CARD_STYLE.paper
  g.fillRect(0, 0, W, H)
  speckles(g, W, H)
  g.strokeStyle = CARD_STYLE.edge
  g.lineWidth = 6
  g.strokeRect(3, 3, W - 6, H - 6)
  // Shrink the text until every credit (role row + its lines) fits the rules;
  // past the smallest size, the rules close up instead.
  let size: number = COMPACT_TEXT.max
  let entries: CardEntry[] = []
  for (; size >= COMPACT_TEXT.min; size--) {
    g.font = font(400, size, FONT.card)
    entries = layoutCompact(credits, canvasMeasure(g))
    if (compactRows(entries) <= ruledLines(grid)) break
  }
  size = Math.max(size, COMPACT_TEXT.min)
  const pitch = compactPitch(compactRows(entries), grid)

  g.fillStyle = CARD_STYLE.rule
  for (let y = grid.firstRule; y <= grid.lastRule + 1; y += pitch) g.fillRect(20, y, W - 40, 2)
  g.fillStyle = CARD_STYLE.head
  g.fillRect(20, grid.headRule, W - 40, 3)

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = CARD_STYLE.ink
  g.font = font(700, 58, FONT.card)
  g.fillText('CREDITS', grid.left, grid.headRule - 28)

  const baseline = (r: number) => grid.firstRule + r * pitch - 8
  let row = 0
  for (const entry of entries) {
    g.font = font(700, Math.min(26, size - 4), FONT.card)
    g.fillStyle = CARD_STYLE.role
    g.fillText(entry.role, grid.left, baseline(row))
    row++
    g.font = font(400, size, FONT.card)
    g.fillStyle = CARD_STYLE.ink
    for (const line of entry.lines) {
      g.fillText(line, grid.left, baseline(row))
      row++
    }
  }
  g.restore()
}
