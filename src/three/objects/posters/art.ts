import type { Poster, TechPoster, TributePoster } from '../../../content/posters'
import { font, FONT } from '../../../screens/fonts'
import { fitSize } from '../../../screens/text'
import { hashId, random } from '../tapes/labelAtlas'
import { MARK_BOX, MARKS, type Mark } from './marks'

/**
 * The posters' art, drawn once into the atlas after the screen fonts are in
 * (deterministic: every random choice comes from the poster id's seed).
 *
 * Tech posters: Swiss / International style around a Simple Icons mark (a
 * big brand-colour field, a strict grid, condensed Archivo, a JetBrains Mono
 * caption) in a thin black frame. Tributes: ORIGINAL compositions in the
 * mood of each work (shapes, palettes and our own fonts; no official art,
 * logos or lettering), held up by paper tape. Every sheet gets grain and wear.
 *
 * Geometry helpers (rays, strokes, bands, streaks) are pure and unit tested;
 * the rest needs a 2D canvas.
 */

export type Rand = () => number

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

export interface Ray {
  readonly angle: number
  /** Inner and outer radius as multiples of the disc radius. */
  readonly from: number
  readonly to: number
  /** Angular half width (rad). */
  readonly spread: number
  readonly alpha: number
}

/** The eclipse's corona: uneven streamers around the black sun. */
export function coronaRays(rand: Rand, count: number): Ray[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i + rand() * 0.8) / count) * Math.PI * 2
    const long = rand() < 0.22
    return {
      angle,
      from: 0.96,
      to: long ? 2.1 + rand() * 0.9 : 1.25 + rand() * 0.55,
      spread: 0.012 + rand() * 0.05,
      alpha: 0.25 + rand() * 0.55,
    }
  })
}

export interface BrushPoint {
  readonly x: number
  readonly y: number
  readonly width: number
}

/**
 * An ensō as a pressure-varying centreline: starts heavy, thins out and
 * leaves the circle open (`span` < 2π). Coordinates relative to the centre,
 * in units of the radius.
 */
export function ensoPath(rand: Rand, steps = 240, span = Math.PI * 1.82): BrushPoint[] {
  const start = -Math.PI * 0.62 + (rand() - 0.5) * 0.3
  const wobble = [rand() * 6.28, rand() * 6.28, rand() * 6.28]
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const angle = start + span * t
    const r = 1 + 0.035 * Math.sin(angle * 2 + (wobble[0] ?? 0)) + 0.02 * Math.sin(angle * 5 + (wobble[1] ?? 0))
    // Pressed down at the start, lifting off toward the end.
    const pressure = Math.min(1, t * 9) * (1 - 0.72 * t ** 1.4) * (0.92 + 0.08 * Math.sin(t * 17 + (wobble[2] ?? 0)))
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, width: 0.2 * pressure }
  })
}

export interface Band {
  readonly y: number
  readonly h: number
  readonly dx: number
}

/** Glitch slices: horizontal bands of a `height`-tall poster shifted sideways by up to `maxShift`. */
export function glitchBands(rand: Rand, count: number, height: number, maxShift: number): Band[] {
  return Array.from({ length: count }, () => {
    const h = height * (0.004 + rand() * 0.035)
    const y = rand() * (height - h)
    return { y, h, dx: (rand() - 0.5) * 2 * maxShift }
  })
}

export interface Segment {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** Rain streaks leaning by `angle` (rad), clipped into a w × h sheet. */
export function rainStreaks(rand: Rand, count: number, w: number, h: number, angle: number, length: number): Segment[] {
  const dx = Math.sin(angle) * length
  const dy = Math.cos(angle) * length
  return Array.from({ length: count }, () => {
    const len = 0.5 + rand() * 0.8
    const x0 = rand() * w
    const y0 = rand() * h
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))
    return { x0, y0, x1: clamp(x0 - dx * len, w), y1: clamp(y0 + dy * len, h) }
  })
}

/** Halftone dot radius for a darkness 0..1 in a cell of `cell` px (area-true, capped so dots just touch). */
export function halftoneRadius(darkness: number, cell: number): number {
  const d = Math.min(1, Math.max(0, darkness))
  return Math.min(cell * 0.62, Math.sqrt(d / Math.PI) * cell)
}

/** Wide tracking: x of each character for `text` laid out with `tracking` extra px after each glyph. */
export function trackedPositions(widths: readonly number[], tracking: number): { xs: number[]; width: number } {
  const xs: number[] = []
  let x = 0
  widths.forEach((width, i) => {
    xs.push(x)
    x += width + (i < widths.length - 1 ? tracking : 0)
  })
  return { xs, width: x }
}

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                       */
/* ------------------------------------------------------------------ */

type StretchContext = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string }

/** Archivo with its width axis (falls back to a horizontal squeeze), returns the squeeze to apply. */
function setUi(g: StretchContext, weight: number, size: number, stretch: 'condensed' | 'semi-condensed' | 'normal' | 'expanded' = 'normal'): number {
  g.font = font(weight, size, FONT.ui)
  if ('fontStretch' in g) {
    g.fontStretch = stretch
    return 1
  }
  return stretch === 'condensed' ? 0.8 : stretch === 'semi-condensed' ? 0.9 : 1
}

function resetStretch(g: StretchContext): void {
  if ('fontStretch' in g) g.fontStretch = 'normal'
}

/** Largest size (px) at which `text` fits `maxWidth` in Archivo `weight` / `stretch`. */
function fitUi(g: StretchContext, text: string, weight: number, maxWidth: number, max: number, min: number, stretch: 'condensed' | 'normal' = 'normal'): number {
  return fitSize(maxWidth, max, min, (size) => {
    const squeeze = setUi(g, weight, size, stretch)
    return g.measureText(text).width * squeeze
  })
}

/** Draws text in Archivo with an optional squeeze fallback (left / baseline). */
function uiText(g: StretchContext, text: string, x: number, y: number, weight: number, size: number, color: string, stretch: 'condensed' | 'normal' = 'normal', align: CanvasTextAlign = 'left'): void {
  const squeeze = setUi(g, weight, size, stretch)
  g.save()
  g.translate(x, y)
  g.scale(squeeze, 1)
  g.fillStyle = color
  g.textAlign = align
  g.textBaseline = 'alphabetic'
  g.fillText(text, 0, 0)
  g.restore()
  resetStretch(g)
}

function monoText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 400): void {
  g.font = font(weight, size, FONT.mono)
  g.fillStyle = color
  g.textAlign = align
  g.textBaseline = 'alphabetic'
  g.fillText(text, x, y)
}

/** Text with wide tracking (manual placement, so it works without canvas letterSpacing). */
function trackedText(g: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number, color: string, align: 'left' | 'center' = 'left'): number {
  const chars = [...text]
  const { xs, width } = trackedPositions(
    chars.map((char) => g.measureText(char).width),
    tracking,
  )
  const left = align === 'center' ? x - width / 2 : x
  g.fillStyle = color
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  chars.forEach((char, i) => g.fillText(char, left + (xs[i] ?? 0), y))
  return width
}

let grainCanvas: HTMLCanvasElement | null = null

/** Shared 256² grain tile (written once with putImageData). */
function grainTile(): HTMLCanvasElement | null {
  if (grainCanvas) return grainCanvas
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')
  if (!g) return null
  const image = g.createImageData(256, 256)
  const rand = random(0x2545f491)
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 80 + rand() * 96
    image.data[i] = value
    image.data[i + 1] = value
    image.data[i + 2] = value
    image.data[i + 3] = 255
  }
  g.putImageData(image, 0, 0)
  grainCanvas = canvas
  return grainCanvas
}

/** Paper grain + a few fibres and a soft darkening toward the edges. */
function paperFinish(g: CanvasRenderingContext2D, w: number, h: number, rand: Rand, amount: number): void {
  const tile = grainTile()
  const pattern = tile ? g.createPattern(tile, 'repeat') : null
  g.save()
  if (pattern) {
    g.globalAlpha = amount
    g.globalCompositeOperation = 'overlay'
    g.fillStyle = pattern
    g.fillRect(0, 0, w, h)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = rand() < 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)'
    g.lineWidth = Math.max(1, w * 0.0015)
    const x = rand() * w
    const y = rand() * h
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + w * 0.03, y + (rand() - 0.5) * h * 0.02, x + w * (0.04 + rand() * 0.08), y + (rand() - 0.5) * h * 0.02)
    g.stroke()
  }
  const vignette = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.22)')
  g.fillStyle = vignette
  g.fillRect(0, 0, w, h)
  g.restore()
}

/** Paper tape over two or four corners (slightly torn ends). */
function tapeCorners(g: CanvasRenderingContext2D, w: number, h: number, rand: Rand): void {
  const size = Math.min(w, h)
  const corners: Array<[number, number, number]> = [
    [0, 0, -0.75],
    [w, 0, 0.75],
    [0, h, 0.75],
    [w, h, -0.75],
  ]
  const skip = rand() < 0.5 ? 2 + Math.floor(rand() * 2) : -1
  corners.forEach(([x, y, angle], i) => {
    if (i === skip) return
    const length = size * (0.2 + rand() * 0.06)
    const thick = size * (0.065 + rand() * 0.015)
    g.save()
    g.translate(x, y)
    g.rotate(angle + (rand() - 0.5) * 0.2)
    g.beginPath()
    const half = length / 2
    g.moveTo(-half, -thick / 2)
    for (let k = 0; k <= 4; k++) g.lineTo(-half + (length * k) / 4, -thick / 2 + (rand() - 0.5) * thick * 0.08)
    for (let k = 0; k <= 3; k++) g.lineTo(half + (rand() - 0.5) * thick * 0.2, -thick / 2 + (thick * k) / 3)
    for (let k = 4; k >= 0; k--) g.lineTo(-half + (length * k) / 4, thick / 2 + (rand() - 0.5) * thick * 0.08)
    for (let k = 3; k >= 0; k--) g.lineTo(-half + (rand() - 0.5) * thick * 0.2, -thick / 2 + (thick * k) / 3)
    g.closePath()
    g.fillStyle = 'rgba(232, 222, 192, 0.82)'
    g.fill()
    g.strokeStyle = 'rgba(120, 104, 70, 0.25)'
    g.lineWidth = Math.max(1, size * 0.003)
    g.stroke()
    g.restore()
  })
}

/** Thin black frame (tech posters). */
function thinFrame(g: CanvasRenderingContext2D, w: number, h: number): void {
  const t = Math.max(2, Math.min(w, h) * 0.022)
  g.save()
  g.strokeStyle = '#0e0e10'
  g.lineWidth = t
  g.strokeRect(t / 2, t / 2, w - t, h - t)
  g.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  g.lineWidth = Math.max(1, t * 0.18)
  g.strokeRect(t * 1.05, t * 1.05, w - t * 2.1, h - t * 2.1)
  g.restore()
}

function drawMark(g: CanvasRenderingContext2D, mark: Mark, x: number, y: number, size: number, color: string): void {
  if (typeof Path2D === 'undefined') return
  g.save()
  g.translate(x, y)
  g.scale(size / MARK_BOX, size / MARK_BOX)
  g.fillStyle = color
  g.fill(new Path2D(mark.path))
  g.restore()
}

/** A tapered brush stroke along a quadratic curve (width w0 → w1). */
function brush(g: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number, w1: number, color: string): void {
  const steps = 18
  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1
    const tx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
    const ty = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
    const length = Math.hypot(tx, ty) || 1
    const half = (w0 + (w1 - w0) * t) / 2
    left.push([x - (ty / length) * half, y + (tx / length) * half])
    right.push([x + (ty / length) * half, y - (tx / length) * half])
  }
  g.beginPath()
  left.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
  for (let i = right.length - 1; i >= 0; i--) {
    const point = right[i]
    if (point) g.lineTo(point[0], point[1])
  }
  g.closePath()
  g.fillStyle = color
  g.fill()
}

/* ------------------------------------------------------------------ */
/* Tech posters (Swiss style)                                           */
/* ------------------------------------------------------------------ */

function techPortrait(g: StretchContext, poster: TechPoster, w: number, h: number): void {
  const { palette } = poster
  const m = w * 0.085
  g.fillStyle = palette.paper
  g.fillRect(0, 0, w, h)

  // Grid: six columns of hairlines (the Swiss scaffold), faint.
  g.fillStyle = palette.accent2
  g.globalAlpha = 0.18
  for (let i = 1; i < 6; i++) g.fillRect(m + ((w - 2 * m) * i) / 6, m, Math.max(1, w * 0.002), h - 2 * m)
  g.globalAlpha = 1

  const markSize = (w - 2 * m) * (poster.mark === 'react-next' ? 0.74 : 0.66)
  const markY = m * 1.1
  if (poster.mark === 'react-next') {
    drawMark(g, MARKS.react, m, markY, markSize, palette.accent)
  } else {
    drawMark(g, MARKS[poster.mark], m, markY, markSize, palette.ink)
  }
  // Index top right.
  monoText(g, poster.mark === 'react-next' ? 'N°03' : poster.mark === 'typescript' ? 'N°01' : 'N°02', w - m, m + w * 0.05, w * 0.045, palette.ink, 'right', 700)

  // Thick rule, then the title in condensed Archivo.
  const ruleY = h * 0.62
  g.fillStyle = palette.ink
  g.fillRect(m, ruleY, w - 2 * m, Math.max(2, h * 0.01))
  const lines = poster.mark === 'react-next' ? ['React', 'Next.js'] : [poster.title]
  let y = ruleY + h * 0.02
  for (const [i, line] of lines.entries()) {
    const size = fitUi(g, line, 900, (w - 2 * m) * (i === 1 ? 0.78 : 1), h * (lines.length > 1 ? 0.085 : 0.11), 8, 'condensed')
    y += size * 0.95
    uiText(g, line, m, y, 900, size, palette.ink, 'condensed')
    if (i === 1) drawMark(g, MARKS.next, w - m - size * 0.82, y - size * 0.8, size * 0.82, palette.ink)
  }
  if (poster.subtitle) {
    const size = fitUi(g, poster.subtitle, 500, w - 2 * m, h * 0.034, 6)
    y += size * 1.7
    uiText(g, poster.subtitle, m, y, 500, size, palette.ink)
  }
  // Mono caption on the bottom grid line: since + the role it plays.
  const capSize = w * 0.04
  g.fillStyle = palette.ink
  g.globalAlpha = 0.85
  g.fillRect(m, h - m - capSize * 1.9, w - 2 * m, Math.max(1, h * 0.003))
  g.globalAlpha = 1
  monoText(g, poster.since.toUpperCase(), m, h - m, capSize, palette.ink, 'left', 700)
  monoText(g, poster.mark === 'react-next' ? 'FRONTEND' : 'LANGUAGE', w - m, h - m, capSize, palette.ink, 'right')
}

function techBanner(g: StretchContext, poster: TechPoster, w: number, h: number): void {
  const { palette } = poster
  const m = h * 0.14
  g.fillStyle = palette.paper
  g.fillRect(0, 0, w, h)
  const markSize = h - 2 * m
  drawMark(g, MARKS[poster.mark === 'react-next' ? 'react' : poster.mark], m, m, markSize, palette.accent)
  const left = m * 2 + markSize
  const size = fitUi(g, poster.title, 900, w - left - m, h * 0.42, 6, 'condensed')
  uiText(g, poster.title, left, m + size * 0.82, 900, size, palette.ink, 'condensed')
  g.fillStyle = palette.ink
  g.fillRect(left, h * 0.62, w - left - m, Math.max(1, h * 0.02))
  monoText(g, poster.since.toUpperCase(), left, h - m, h * 0.12, palette.ink, 'left', 700)
}

function drawTech(g: StretchContext, poster: TechPoster, w: number, h: number, rand: Rand): void {
  if (w > h * 1.4) techBanner(g, poster, w, h)
  else techPortrait(g, poster, w, h)
  paperFinish(g, w, h, rand, 0.1)
  thinFrame(g, w, h)
}

/* ------------------------------------------------------------------ */
/* Tributes (original art)                                              */
/* ------------------------------------------------------------------ */

/** Black eclipse with a crimson corona over a blood-red sky; a tiny lone swordsman on the cliff. */
function drawBerserk(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  const { palette } = poster
  const horizon = h * 0.66
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#120203')
  sky.addColorStop(0.45, '#4a060b')
  sky.addColorStop(0.8, palette.accent)
  sky.addColorStop(1, palette.accent2)
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)

  // Corona and glow.
  const cx = w * 0.5
  const cy = h * 0.34
  const r = w * 0.17
  const glow = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 3.2)
  glow.addColorStop(0, 'rgba(255, 90, 50, 0.55)')
  glow.addColorStop(0.35, 'rgba(200, 20, 30, 0.25)')
  glow.addColorStop(1, 'rgba(120, 0, 10, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, w, h)
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (const ray of coronaRays(rand, 64)) {
    g.beginPath()
    g.moveTo(cx + Math.cos(ray.angle - ray.spread) * r * ray.from, cy + Math.sin(ray.angle - ray.spread) * r * ray.from)
    g.lineTo(cx + Math.cos(ray.angle) * r * ray.to, cy + Math.sin(ray.angle) * r * ray.to)
    g.lineTo(cx + Math.cos(ray.angle + ray.spread) * r * ray.from, cy + Math.sin(ray.angle + ray.spread) * r * ray.from)
    g.closePath()
    g.fillStyle = `rgba(255, ${Math.round(40 + rand() * 60)}, 30, ${(ray.alpha * 0.45).toFixed(3)})`
    g.fill()
  }
  g.restore()
  // The black sun, with a thin hot rim.
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fillStyle = '#030001'
  g.fill()
  g.strokeStyle = 'rgba(255, 120, 70, 0.9)'
  g.lineWidth = Math.max(1, r * 0.035)
  g.stroke()

  // Dark cloud streaks crossing the sky.
  for (let i = 0; i < 7; i++) {
    const y = h * (0.12 + rand() * 0.45)
    g.beginPath()
    g.ellipse(rand() * w, y, w * (0.2 + rand() * 0.3), h * (0.004 + rand() * 0.008), (rand() - 0.5) * 0.08, 0, Math.PI * 2)
    g.fillStyle = `rgba(10, 0, 2, ${(0.35 + rand() * 0.35).toFixed(3)})`
    g.fill()
  }
  // Crows.
  g.strokeStyle = '#0a0102'
  g.lineWidth = Math.max(1, w * 0.004)
  for (let i = 0; i < 6; i++) {
    const x = w * (0.15 + rand() * 0.7)
    const y = h * (0.08 + rand() * 0.2)
    const s = w * (0.012 + rand() * 0.012)
    g.beginPath()
    g.moveTo(x - s, y - s * 0.3)
    g.quadraticCurveTo(x - s * 0.4, y - s * 0.5, x, y)
    g.quadraticCurveTo(x + s * 0.4, y - s * 0.5, x + s, y - s * 0.3)
    g.stroke()
  }

  // The cliff: jagged, rising to the right of centre.
  const peakX = w * 0.64
  const peakY = horizon - h * 0.07
  g.beginPath()
  g.moveTo(0, h)
  g.lineTo(0, horizon + h * 0.05)
  for (let x = 0; x <= peakX; x += w * 0.04) {
    const k = x / peakX
    g.lineTo(x, horizon + h * 0.05 - (horizon + h * 0.05 - peakY) * k ** 1.6 + (rand() - 0.5) * h * 0.012)
  }
  g.lineTo(peakX + w * 0.05, peakY + h * 0.004)
  for (let x = peakX + w * 0.08; x <= w; x += w * 0.04) g.lineTo(x, peakY + h * 0.03 + ((x - peakX) / w) * h * 0.25 + rand() * h * 0.01)
  g.lineTo(w, h)
  g.closePath()
  g.fillStyle = '#050102'
  g.fill()

  // The lone swordsman: cape, body, head and an oversized blade over his shoulder.
  const fh = h * 0.07
  const fx = peakX + w * 0.015
  const fy = peakY + h * 0.002
  g.fillStyle = '#000000'
  g.beginPath()
  g.moveTo(fx - fh * 0.12, fy - fh * 0.78)
  g.lineTo(fx - fh * 0.62, fy - fh * 0.05)
  g.lineTo(fx - fh * 0.48, fy - fh * 0.12)
  g.lineTo(fx - fh * 0.42, fy - fh * 0.02)
  g.lineTo(fx - fh * 0.3, fy - fh * 0.1)
  g.lineTo(fx - fh * 0.05, fy)
  g.closePath()
  g.fill()
  g.fillRect(fx - fh * 0.14, fy - fh * 0.8, fh * 0.3, fh * 0.48)
  g.fillRect(fx - fh * 0.12, fy - fh * 0.34, fh * 0.1, fh * 0.34)
  g.fillRect(fx + fh * 0.04, fy - fh * 0.34, fh * 0.1, fh * 0.34)
  g.beginPath()
  g.arc(fx + fh * 0.01, fy - fh * 0.9, fh * 0.11, 0, Math.PI * 2)
  g.fill()
  g.save()
  g.translate(fx + fh * 0.05, fy - fh * 0.62)
  g.rotate(-0.95)
  g.fillRect(-fh * 0.14, -fh * 0.09, fh * 1.45, fh * 0.2)
  g.fillRect(-fh * 0.3, -fh * 0.05, fh * 0.2, fh * 0.12)
  g.restore()

  // Title block.
  const m = w * 0.07
  const title = poster.title.toUpperCase()
  const size = fitUi(g, title, 900, w - 2 * m, h * 0.16, 8, 'condensed')
  uiText(g, title, w / 2, h - m - h * 0.055, 900, size, palette.ink, 'condensed', 'center')
  g.fillStyle = palette.accent
  g.fillRect(w * 0.3, h - m - h * 0.04, w * 0.4, Math.max(1, h * 0.004))
  g.font = font(400, h * 0.022, FONT.mono)
  trackedText(g, (poster.subtitle ?? '').toUpperCase(), w / 2, h - m, h * 0.008, palette.ink, 'center')
  paperFinish(g, w, h, rand, 0.14)
}

/** Sumi-e: washi paper, an ink ensō and a lone samurai in a few brush strokes; a red seal. */
function drawVagabond(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  const { palette } = poster
  g.fillStyle = palette.paper
  g.fillRect(0, 0, w, h)
  // Washi: mottled tone and long fibres.
  for (let i = 0; i < 40; i++) {
    g.beginPath()
    g.ellipse(rand() * w, rand() * h, w * (0.05 + rand() * 0.15), h * (0.02 + rand() * 0.06), rand() * Math.PI, 0, Math.PI * 2)
    g.fillStyle = `rgba(${rand() < 0.5 ? '150, 130, 100' : '255, 250, 240'}, 0.06)`
    g.fill()
  }
  g.lineCap = 'round'
  for (let i = 0; i < 160; i++) {
    const x = rand() * w
    const y = rand() * h
    const a = rand() * Math.PI * 2
    const l = w * (0.02 + rand() * 0.07)
    g.strokeStyle = `rgba(${rand() < 0.6 ? '120, 100, 70' : '255, 255, 250'}, ${(0.08 + rand() * 0.1).toFixed(3)})`
    g.lineWidth = Math.max(1, w * 0.0015)
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }

  // The ensō, as dry-brush bristles that run out of ink at different points.
  const cx = w * 0.5
  const cy = h * 0.4
  const radius = w * 0.31
  const path = ensoPath(rand)
  const bristles = 16
  const dryAt = Array.from({ length: bristles }, () => 0.55 + rand() * 0.45)
  g.strokeStyle = palette.ink
  for (let b = 0; b < bristles; b++) {
    const offset = (b / (bristles - 1) - 0.5) * 2
    g.lineWidth = Math.max(1, w * 0.0075)
    g.globalAlpha = 0.55 + rand() * 0.4
    g.beginPath()
    let drawing = false
    path.forEach((point, i) => {
      const t = i / (path.length - 1)
      // Each bristle runs dry at its own point; a few skip here and there (dry brush).
      const skip = t > (dryAt[b] ?? 1) || (t > 0.35 && rand() < 0.04 * t)
      // Across the stroke: the centreline pushed in / out by the bristle's share of the width.
      const across = 1 + point.width * offset * 0.5
      const x = cx + point.x * radius * across
      const y = cy + point.y * radius * across
      // The outer bristles lift first as the pressure drops.
      if (skip || Math.abs(offset) * 0.5 > point.width * 4) {
        drawing = false
        return
      }
      if (drawing) g.lineTo(x, y)
      else g.moveTo(x, y)
      drawing = true
    })
    g.stroke()
  }
  g.globalAlpha = 1

  // The lone samurai: kasa hat, robe, two swords.
  const sx = w * 0.5
  const sy = h * 0.8
  const s = h * 0.21
  const ink = palette.ink
  brush(g, sx - s * 0.32, sy - s * 0.84, sx, sy - s * 1.0, sx + s * 0.34, sy - s * 0.82, s * 0.07, s * 0.02, ink)
  brush(g, sx - s * 0.05, sy - s * 0.83, sx - s * 0.1, sy - s * 0.4, sx - s * 0.24, sy, s * 0.2, s * 0.08, ink)
  brush(g, sx + s * 0.05, sy - s * 0.8, sx + s * 0.12, sy - s * 0.38, sx + s * 0.2, sy - s * 0.02, s * 0.16, s * 0.05, ink)
  brush(g, sx - s * 0.02, sy - s * 0.56, sx + s * 0.2, sy - s * 0.6, sx + s * 0.48, sy - s * 0.7, s * 0.035, s * 0.012, ink)
  brush(g, sx - s * 0.02, sy - s * 0.5, sx + s * 0.18, sy - s * 0.52, sx + s * 0.38, sy - s * 0.6, s * 0.03, s * 0.01, ink)
  brush(g, sx - s * 0.5, sy + s * 0.02, sx, sy - s * 0.02, sx + s * 0.55, sy + s * 0.03, s * 0.025, s * 0.006, ink)

  // Seal (an abstract mark, no characters).
  const seal = w * 0.075
  const sealX = w * 0.83
  const sealY = h * 0.73
  g.fillStyle = palette.accent
  g.globalAlpha = 0.88
  g.fillRect(sealX, sealY, seal, seal)
  g.globalAlpha = 1
  g.strokeStyle = palette.paper
  g.lineWidth = Math.max(1, seal * 0.08)
  g.beginPath()
  g.moveTo(sealX + seal * 0.25, sealY + seal * 0.25)
  g.lineTo(sealX + seal * 0.75, sealY + seal * 0.25)
  g.moveTo(sealX + seal * 0.5, sealY + seal * 0.25)
  g.lineTo(sealX + seal * 0.5, sealY + seal * 0.78)
  g.moveTo(sealX + seal * 0.28, sealY + seal * 0.55)
  g.lineTo(sealX + seal * 0.72, sealY + seal * 0.55)
  g.stroke()

  // Title: wide tracking at the foot of the sheet.
  const m = w * 0.08
  setUi(g, 800, h * 0.05, 'expanded')
  trackedText(g, poster.title.toUpperCase(), w / 2, h - m - h * 0.035, h * 0.022, palette.ink, 'center')
  resetStretch(g)
  g.font = font(400, h * 0.02, FONT.mono)
  trackedText(g, (poster.subtitle ?? '').toUpperCase(), w / 2, h - m, h * 0.008, palette.accent2, 'center')
  paperFinish(g, w, h, rand, 0.08)
}

/** Pastel lo-fi night: soft gradient, a moon, rain and a figure under an umbrella. */
function drawJoji(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  const { palette } = poster
  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, palette.accent)
  sky.addColorStop(0.55, palette.paper)
  sky.addColorStop(1, '#f6ddd0')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // Moon with a halo.
  const mx = w * 0.76
  const my = h * 0.3
  const mr = h * 0.1
  const halo = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.4)
  halo.addColorStop(0, 'rgba(255, 246, 232, 0.65)')
  halo.addColorStop(1, 'rgba(255, 246, 232, 0)')
  g.fillStyle = halo
  g.fillRect(0, 0, w, h)
  g.beginPath()
  g.arc(mx, my, mr, 0, Math.PI * 2)
  g.fillStyle = palette.accent2
  g.fill()
  // Far hills, the street and its wet shine.
  g.fillStyle = 'rgba(122, 108, 160, 0.45)'
  g.beginPath()
  g.moveTo(0, h * 0.74)
  for (let x = 0; x <= w; x += w / 12) g.lineTo(x, h * (0.7 + Math.sin(x / w * 5 + 1) * 0.025 + rand() * 0.01))
  g.lineTo(w, h)
  g.lineTo(0, h)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(90, 80, 128, 0.55)'
  g.fillRect(0, h * 0.82, w, h * 0.18)
  // The figure under an umbrella, and its reflection.
  const fx = w * 0.3
  const fy = h * 0.82
  const s = h * 0.2
  const drawFigure = (flip: number, alpha: number) => {
    g.save()
    g.translate(fx, fy)
    g.scale(1, flip)
    g.globalAlpha = alpha
    g.fillStyle = palette.ink
    g.beginPath()
    g.arc(0, -s * 0.98, s * 0.42, Math.PI, 0)
    g.lineTo(s * 0.42, -s * 0.94)
    g.lineTo(-s * 0.42, -s * 0.94)
    g.closePath()
    g.fill()
    g.fillRect(-s * 0.012, -s * 0.98, s * 0.024, s * 0.36)
    g.beginPath()
    g.arc(0, -s * 0.6, s * 0.075, 0, Math.PI * 2)
    g.fill()
    g.beginPath()
    g.moveTo(-s * 0.12, -s * 0.52)
    g.lineTo(s * 0.12, -s * 0.52)
    g.lineTo(s * 0.1, -s * 0.12)
    g.lineTo(-s * 0.1, -s * 0.12)
    g.closePath()
    g.fill()
    g.fillRect(-s * 0.08, -s * 0.13, s * 0.05, s * 0.13)
    g.fillRect(s * 0.03, -s * 0.13, s * 0.05, s * 0.13)
    g.restore()
  }
  drawFigure(1, 1)
  drawFigure(-0.6, 0.18)
  // Rain.
  g.save()
  g.strokeStyle = 'rgba(255, 255, 255, 0.32)'
  g.lineWidth = Math.max(1, w * 0.0012)
  g.beginPath()
  for (const streak of rainStreaks(rand, 140, w, h, 0.12, h * 0.07)) {
    g.moveTo(streak.x0, streak.y0)
    g.lineTo(streak.x1, streak.y1)
  }
  g.stroke()
  g.restore()
  // Lower-case title, wide tracking, top left.
  const m = h * 0.1
  setUi(g, 300, h * 0.14, 'expanded')
  trackedText(g, poster.title.toLowerCase(), m, m + h * 0.11, h * 0.05, palette.ink)
  resetStretch(g)
  g.font = font(400, h * 0.045, FONT.mono)
  trackedText(g, (poster.subtitle ?? '').toLowerCase(), m, m + h * 0.2, h * 0.012, palette.ink)
  paperFinish(g, w, h, rand, 0.16)
}

/** Cold blue data glitch: scan lines, shifted type, data blocks and columns of numbers. */
function drawRadiohead(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  const { palette } = poster
  g.fillStyle = palette.paper
  g.fillRect(0, 0, w, h)
  const glow = g.createLinearGradient(0, 0, 0, h)
  glow.addColorStop(0, 'rgba(79, 141, 255, 0.18)')
  glow.addColorStop(0.6, 'rgba(79, 141, 255, 0.02)')
  glow.addColorStop(1, 'rgba(232, 241, 255, 0.1)')
  g.fillStyle = glow
  g.fillRect(0, 0, w, h)
  // Data grid.
  g.fillStyle = 'rgba(120, 170, 255, 0.12)'
  const cell = w / 24
  for (let x = 0; x < w; x += cell) g.fillRect(x, 0, 1, h)
  for (let y = 0; y < h; y += cell) g.fillRect(0, y, w, 1)
  // Data blocks.
  for (let i = 0; i < 70; i++) {
    const bw = cell * (1 + Math.floor(rand() * 5))
    const bh = cell * (0.25 + rand() * 1.2)
    g.fillStyle = rand() < 0.15 ? 'rgba(255, 59, 92, 0.35)' : rand() < 0.5 ? 'rgba(79, 141, 255, 0.28)' : 'rgba(232, 241, 255, 0.12)'
    g.fillRect(Math.floor(rand() * 24) * cell, rand() * h * 0.92, bw, bh)
  }
  // Columns of numbers.
  const mono = h * 0.0125
  g.font = font(400, mono, FONT.mono)
  g.fillStyle = 'rgba(200, 220, 255, 0.45)'
  g.textAlign = 'left'
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 30; row++) {
      const value = Math.floor(rand() * 0xffffff)
        .toString(16)
        .padStart(6, '0')
        .toUpperCase()
      g.fillText(`0x${value}`, w * (0.06 + col * 0.1), h * 0.08 + row * mono * 1.35)
    }
  }
  // The name, stacked, with an RGB split and glitch slices.
  const lines = ['RADIO', 'HEAD']
  const m = w * 0.07
  const size = fitUi(g, 'RADIO', 900, w - 2 * m, h * 0.2, 8, 'condensed')
  const baseY = h * 0.62
  const drawName = (dx: number, color: string) => {
    lines.forEach((line, i) => uiText(g, line, m + dx, baseY + i * size * 0.92, 900, size, color, 'condensed'))
  }
  g.save()
  g.globalCompositeOperation = 'lighter'
  drawName(-w * 0.008, palette.accent2)
  drawName(w * 0.008, palette.accent)
  g.restore()
  drawName(0, palette.ink)
  for (const band of glitchBands(rand, 14, h, w * 0.06)) {
    if (band.y < baseY - size * 1.1 || band.y > baseY + size * 1.2) continue
    g.save()
    g.beginPath()
    g.rect(0, band.y, w, band.h)
    g.clip()
    g.fillStyle = palette.paper
    g.fillRect(0, band.y, w, band.h)
    drawName(band.dx, rand() < 0.3 ? palette.accent : palette.ink)
    g.restore()
  }
  // Scan lines.
  g.fillStyle = 'rgba(0, 0, 0, 0.22)'
  const pitch = Math.max(2, Math.round(h / 260))
  for (let y = 0; y < h; y += pitch * 2) g.fillRect(0, y, w, pitch)
  // Caption.
  monoText(g, (poster.subtitle ?? '').toUpperCase(), m, h - m, h * 0.02, palette.ink, 'left', 700)
  monoText(g, '01001010 // 7', w - m, h - m, h * 0.02, palette.accent, 'right')
  paperFinish(g, w, h, rand, 0.1)
}

/** Grunge xerox: rough halftone water with ripples, toner noise and the name in condensed Archivo. */
function drawNirvana(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  const { palette } = poster
  g.fillStyle = palette.paper
  g.fillRect(0, 0, w, h)
  // Water: halftone that darkens downward, modulated by ripple rings.
  const rx = w * 0.52
  const ry = h * 0.44
  const cell = w / 52
  g.fillStyle = palette.accent
  for (let y = h * 0.16; y < h * 0.8; y += cell) {
    const row = Math.round(y / cell)
    for (let x = cell / 2 + (row % 2) * (cell / 2); x < w; x += cell) {
      const d = Math.hypot(x - rx, (y - ry) * 1.6) / w
      const ripple = 0.5 + 0.5 * Math.cos(d * 70 - 0.6)
      const depth = (y - h * 0.16) / (h * 0.64)
      const value = 0.15 + depth * 0.45 + ripple * 0.32 * Math.exp(-d * 2.2) + (rand() - 0.5) * 0.12
      const r = halftoneRadius(value, cell)
      if (r < 0.4) continue
      g.beginPath()
      g.arc(x + (rand() - 0.5) * cell * 0.15, y, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  // Ripple rings (photocopied line work).
  g.strokeStyle = palette.ink
  for (let k = 1; k <= 6; k++) {
    g.lineWidth = Math.max(1, w * 0.004 * (1 - k * 0.1))
    g.globalAlpha = 0.75 - k * 0.09
    g.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
      const wobble = 1 + (rand() - 0.5) * 0.02
      const x = rx + Math.cos(a) * w * 0.05 * k * 1.25 * wobble
      const y = ry + Math.sin(a) * h * 0.012 * k * 1.25 * wobble
      if (a === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  g.globalAlpha = 1
  // Toner: vertical streaks, specks and smudged edges.
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(20, 20, 20, ${(0.04 + rand() * 0.08).toFixed(3)})`
    g.fillRect(rand() * w, 0, w * (0.002 + rand() * 0.01), h)
  }
  g.fillStyle = palette.ink
  for (let i = 0; i < 900; i++) {
    const s = rand() * w * 0.003
    g.fillRect(rand() * w, rand() * h, s, s)
  }
  const edge = g.createLinearGradient(0, 0, w, 0)
  edge.addColorStop(0, 'rgba(20, 20, 20, 0.35)')
  edge.addColorStop(0.08, 'rgba(20, 20, 20, 0)')
  edge.addColorStop(0.92, 'rgba(20, 20, 20, 0)')
  edge.addColorStop(1, 'rgba(20, 20, 20, 0.3)')
  g.fillStyle = edge
  g.fillRect(0, 0, w, h)
  // The name, slightly askew, eroded like a bad copy.
  const m = w * 0.07
  const title = poster.title.toUpperCase()
  const size = fitUi(g, title, 900, w - 2 * m, h * 0.17, 8, 'condensed')
  g.save()
  g.translate(w / 2, h * 0.93)
  g.rotate(-0.025)
  uiText(g, title, 0, 0, 900, size, palette.ink, 'condensed', 'center')
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 320; i++) {
    const s = rand() * size * 0.04
    g.fillRect((rand() - 0.5) * w, -size * rand(), s, s)
  }
  g.restore()
  g.font = font(700, h * 0.022, FONT.mono)
  trackedText(g, (poster.subtitle ?? '').toUpperCase(), m, h * 0.1, h * 0.006, palette.ink)
  paperFinish(g, w, h, rand, 0.18)
}

function drawTribute(g: StretchContext, poster: TributePoster, w: number, h: number, rand: Rand): void {
  switch (poster.art) {
    case 'berserk':
      drawBerserk(g, poster, w, h, rand)
      break
    case 'vagabond':
      drawVagabond(g, poster, w, h, rand)
      break
    case 'joji':
      drawJoji(g, poster, w, h, rand)
      break
    case 'radiohead':
      drawRadiohead(g, poster, w, h, rand)
      break
    case 'nirvana':
      drawNirvana(g, poster, w, h, rand)
      break
  }
  tapeCorners(g, w, h, rand)
}

/** One poster in its own w × h space (the caller translates and clips). */
export function drawPoster(g: CanvasRenderingContext2D, poster: Poster, w: number, h: number): void {
  const rand = random(hashId(poster.id))
  g.save()
  if (poster.kind === 'tech') drawTech(g, poster, w, h, rand)
  else drawTribute(g, poster, w, h, rand)
  g.restore()
}

/**
 * The owner's own image (src/assets/posters/<id>.*), cover-cropped into the
 * sheet, with the same grain and frame / tape as the generated art.
 */
export function drawPosterImage(g: CanvasRenderingContext2D, poster: Poster, image: CanvasImageSource & { width: number; height: number }, w: number, h: number): void {
  const rand = random(hashId(poster.id))
  const scale = Math.max(w / image.width, h / image.height)
  const sw = w / scale
  const sh = h / scale
  g.save()
  g.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, w, h)
  paperFinish(g, w, h, rand, 0.08)
  if (poster.kind === 'tech') thinFrame(g, w, h)
  else tapeCorners(g, w, h, rand)
  g.restore()
}
