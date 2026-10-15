import { osdText, playGlyph } from '../../draw'

/** VCR blue (no signal / no tape). */
export const VCR_BLUE = '#0000aa'
/** Dark CRT background for picture channels. */
export const TV_BLACK = '#05060c'
export const TV_ACCENT = '#9fc4ff'
export const TV_YELLOW = '#ffd75e'

export const TV_MARGIN = 40

/** Top-left "PLAY ▶" OSD (the triangle is drawn, not a glyph). */
export function playOsd(g: CanvasRenderingContext2D, x = TV_MARGIN, y = 58): void {
  osdText(g, 'PLAY', x, y, { size: 38 })
  g.save()
  g.translate(2, 2)
  playGlyph(g, x + 78, y - 12, 26, 'rgba(0, 0, 0, 0.85)')
  g.restore()
  playGlyph(g, x + 78, y - 12, 26)
}

/** Top-right channel number. */
export function channelOsd(g: CanvasRenderingContext2D, text: string, width: number, y = 58): void {
  osdText(g, text, width - TV_MARGIN, y, { size: 38, align: 'right' })
}
