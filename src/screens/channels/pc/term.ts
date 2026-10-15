import { font, FONT } from '../../fonts'

/** Green phosphor terminal look shared by the PC channels. */
export const PHOSPHOR = '#33ff66'
export const PHOSPHOR_DIM = '#1f9c43'
export const PHOSPHOR_HOT = '#a6ffbf'
export const PC_BG = '#010702'
export const PC_MARGIN = 44
export const TERM_SIZE = 24
export const TERM_LINE = 30
/** Baseline of the first terminal row. */
export const TERM_TOP = PC_MARGIN + TERM_SIZE

export function termFont(weight = 400, size = TERM_SIZE): string {
  return font(weight, size, FONT.mono)
}

export function clearTerm(g: CanvasRenderingContext2D, width: number, height: number): void {
  g.fillStyle = PC_BG
  g.fillRect(0, 0, width, height)
}

/** Terminal text at row `row` (0-based). */
export function termLine(g: CanvasRenderingContext2D, text: string, row: number, color = PHOSPHOR, x = PC_MARGIN): void {
  g.font = termFont()
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillStyle = color
  g.fillText(text, x, TERM_TOP + row * TERM_LINE)
}

/** Advance of one monospace character at the terminal size. */
export function charWidth(g: CanvasRenderingContext2D): number {
  g.font = termFont()
  return g.measureText('M').width
}

/** Block cursor at a character column of a row. */
export function blockCursor(g: CanvasRenderingContext2D, column: number, row: number, cw: number, color = PHOSPHOR): void {
  g.fillStyle = color
  g.fillRect(PC_MARGIN + column * cw, TERM_TOP + row * TERM_LINE - TERM_SIZE + 3, Math.ceil(cw), TERM_SIZE + 2)
}
