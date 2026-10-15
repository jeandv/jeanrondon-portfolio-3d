import { font, FONT } from './fonts'

/** Shared Canvas2D drawing helpers for the channels. */

export type Align = 'left' | 'center' | 'right'

export interface OsdOptions {
  readonly size: number
  readonly color?: string
  readonly align?: Align
  /** Hard black drop shadow, like a VCR on-screen display. */
  readonly shadow?: boolean
  readonly family?: string
  readonly weight?: number
}

/** VCR-style OSD text (VT323 by default) at baseline `y`. */
export function osdText(g: CanvasRenderingContext2D, text: string, x: number, y: number, options: OsdOptions): void {
  const { size, color = '#ffffff', align = 'left', shadow = true, family = FONT.osd, weight = 400 } = options
  g.font = font(weight, size, family)
  g.textAlign = align
  g.textBaseline = 'alphabetic'
  if (shadow) {
    const offset = Math.max(2, Math.round(size / 14))
    g.fillStyle = 'rgba(0, 0, 0, 0.85)'
    g.fillText(text, x + offset, y + offset)
  }
  g.fillStyle = color
  g.fillText(text, x, y)
}

/** Solid "play" triangle (drawn, so no glyph can fall back to another font). */
export function playGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#ffffff'): void {
  g.beginPath()
  g.moveTo(x, y - size / 2)
  g.lineTo(x + size * 0.86, y)
  g.lineTo(x, y + size / 2)
  g.closePath()
  g.fillStyle = color
  g.fill()
}

/** Tape counter `HH:MM:SS`. */
export function formatCounter(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600) % 100)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}

/** True during the visible half of a blink cycle. */
export function blinkOn(t: number, hz: number): boolean {
  return Math.floor(t * hz * 2) % 2 === 0
}

/* ------------------------------------------------------------------ */
/* Noise: a small tile regenerated per draw and scaled up (cheap)        */
/* ------------------------------------------------------------------ */

interface NoiseTile {
  readonly canvas: HTMLCanvasElement
  readonly g: CanvasRenderingContext2D
  readonly image: ImageData
}

const TILE_W = 160
const TILE_H = 120
let tile: NoiseTile | null = null

function noiseTile(): NoiseTile | null {
  if (tile) return tile
  const canvas = document.createElement('canvas')
  canvas.width = TILE_W
  canvas.height = TILE_H
  const g = canvas.getContext('2d')
  if (!g) return null
  tile = { canvas, g, image: g.createImageData(TILE_W, TILE_H) }
  return tile
}

/** Fresh grey noise over a rect (`alpha` blends it with what is below). */
export function drawNoise(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 1): void {
  const t = noiseTile()
  if (!t) return
  const data = t.image.data
  for (let i = 0; i < data.length; i += 4) {
    const v = (Math.random() * 255) | 0
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = 255
  }
  t.g.putImageData(t.image, 0, 0)
  g.save()
  g.globalAlpha = alpha
  g.imageSmoothingEnabled = false
  const rows = Math.max(1, Math.round((h / g.canvas.height) * TILE_H))
  g.drawImage(t.canvas, 0, 0, TILE_W, Math.min(TILE_H, rows), x, y, w, h)
  g.restore()
}

/**
 * VHS tracking bands: horizontal slices of the frame shifted sideways and
 * covered in noise, rolling down the screen while `strength` > 0.
 */
export function trackingBands(g: CanvasRenderingContext2D, t: number, strength: number): void {
  if (strength <= 0) return
  const { width, height } = g.canvas
  for (let i = 0; i < 3; i++) {
    const bandH = 14 + i * 10
    const y = Math.round(((t * 520 + i * 173) % (height + 80)) - 40)
    const shift = Math.round(Math.sin(t * 37 + i * 2.1) * 18 * strength)
    const top = Math.max(0, y)
    const h = Math.min(height, y + bandH) - top
    if (h <= 0) continue
    g.drawImage(g.canvas, 0, top, width, h, shift, top, width, h)
    drawNoise(g, 0, top, width, h, 0.45 * strength)
  }
}
