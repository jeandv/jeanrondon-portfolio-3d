import type { Tape } from '../../../content/types'
import { font, FONT } from '../../../screens/fonts'
import { ellipsize, fitSize, type Measure } from '../../../screens/text'

/**
 * VHS spine labels: one canvas atlas (one row per shelf slot) drawn once from
 * src/content. Retail-tape look: coloured label stock picked from the tape id,
 * a thin rule, paper grain and slightly worn, uneven edges (alpha-tested).
 * Layout and styles are pure (unit tested); drawing needs a 2D canvas.
 */

export const ATLAS_SIZE = 1024
export const ATLAS_ROWS = 8
export const ROW_HEIGHT = ATLAS_SIZE / ATLAS_ROWS
/** Transparent margin (px) around each label: mip levels never bleed rows together. */
export const ROW_PAD = 4

/** Atlas row of a shelf slot (1 → row 0). */
export function atlasRow(slot: number): number {
  return Math.min(ATLAS_ROWS - 1, Math.max(0, Math.round(slot) - 1))
}

export interface UvRect {
  readonly u0: number
  readonly u1: number
  /** v grows downward (texture flipY = false, like glTF). */
  readonly v0: number
  readonly v1: number
}

/** UV rectangle of a row's label (inside its padding). */
export function rowUv(row: number): UvRect {
  const top = row * ROW_HEIGHT + ROW_PAD
  return {
    u0: ROW_PAD / ATLAS_SIZE,
    u1: 1 - ROW_PAD / ATLAS_SIZE,
    v0: top / ATLAS_SIZE,
    v1: (top + ROW_HEIGHT - ROW_PAD * 2) / ATLAS_SIZE,
  }
}

/** Maps a 0..1 UV (glTF orientation) into a row's rectangle. */
export function remapToRow(u: number, v: number, rect: UvRect): [number, number] {
  return [rect.u0 + u * (rect.u1 - rect.u0), rect.v0 + v * (rect.v1 - rect.v0)]
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

export interface LabelStock {
  readonly stock: string
  readonly ink: string
  readonly accent: string
}

/** Muted retail label stocks (sRGB). */
export const STOCKS: readonly LabelStock[] = [
  { stock: '#d8c696', ink: '#2a2118', accent: '#a8432f' },
  { stock: '#a8432f', ink: '#f3e9d6', accent: '#e7c26a' },
  { stock: '#2f4f86', ink: '#eef0f2', accent: '#e9b949' },
  { stock: '#e2dbc9', ink: '#1d2433', accent: '#2f6b8a' },
  { stock: '#3e6650', ink: '#f1ead8', accent: '#e2b25a' },
  { stock: '#c9952f', ink: '#231a10', accent: '#7c2d26' },
  { stock: '#6a3d5e', ink: '#f2e6ea', accent: '#e3a85b' },
  { stock: '#2c2f36', ink: '#e9e4d8', accent: '#d5463a' },
  { stock: '#2e6f73', ink: '#eef3ef', accent: '#f0c05a' },
  { stock: '#c8705a', ink: '#22160f', accent: '#2c3e5c' },
]

/** Unlabelled tape in an empty slot: plain white stock with ruled lines. */
export const BLANK_STOCK: LabelStock = { stock: '#e6e0d0', ink: '#6d6a63', accent: '#9fb3c8' }

export type LabelVariant = 'band' | 'rules' | 'stripes'
const VARIANTS: readonly LabelVariant[] = ['band', 'rules', 'stripes']

export interface LabelStyle extends LabelStock {
  readonly variant: LabelVariant
  /** Seed for the grain and the worn edges. */
  readonly seed: number
}

/** FNV-1a (32-bit), stable across runs. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface LabelEntry {
  readonly slot: number
  readonly id: string
}

/**
 * One style per tape: the stock comes from the id's hash, probing forward so
 * no two tapes on the shelf share a colour (slot order decides who probes).
 */
export function labelStyles(entries: readonly LabelEntry[]): Map<number, LabelStyle> {
  const styles = new Map<number, LabelStyle>()
  const used = new Set<number>()
  for (const { slot, id } of [...entries].sort((a, b) => a.slot - b.slot)) {
    const hash = hashId(id)
    let index = hash % STOCKS.length
    for (let probe = 0; probe < STOCKS.length && used.has(index); probe++) index = (index + 1) % STOCKS.length
    used.add(index)
    const stock = STOCKS[index] ?? BLANK_STOCK
    styles.set(slot, { ...stock, variant: VARIANTS[(hash >>> 8) % VARIANTS.length] ?? 'band', seed: hash })
  }
  return styles
}

/** Seeded PRNG (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FittedText {
  readonly text: string
  readonly size: number
}

/** Largest size in [min, max] that fits; at `min`, ellipsized. */
export function fitLabelText(text: string, maxWidth: number, max: number, min: number, measureAt: (text: string, size: number) => number): FittedText {
  const size = fitSize(maxWidth, max, min, (candidate) => measureAt(text, candidate))
  const measure: Measure = (candidate) => measureAt(candidate, size)
  return { text: ellipsize(text, maxWidth, measure), size }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                              */
/* ------------------------------------------------------------------ */

export interface AtlasEntry {
  readonly slot: number
  /** Undefined: an unlabelled tape (blank stock). */
  readonly tape?: Tape
}

/** Narrow (wdth 75) when the browser supports canvas font-stretch, else a horizontal squeeze. */
const CONDENSED_SQUEEZE = 0.8

type StretchContext = CanvasRenderingContext2D & { fontStretch?: string }

function setTitleFont(g: StretchContext, size: number): number {
  g.font = font(900, size, FONT.ui)
  if ('fontStretch' in g) {
    g.fontStretch = 'condensed'
    return 1
  }
  return CONDENSED_SQUEEZE
}

/** Label outline with slightly irregular, worn edges. */
function wornOutline(w: number, h: number, rand: () => number): Path2D {
  const step = 9
  const jitter = () => rand() * 1.8
  const path = new Path2D()
  path.moveTo(jitter(), jitter())
  for (let x = step; x < w; x += step) path.lineTo(x, jitter())
  path.lineTo(w - jitter(), jitter())
  for (let y = step; y < h; y += step) path.lineTo(w - jitter(), y)
  path.lineTo(w - jitter(), h - jitter())
  for (let x = w - step; x > 0; x -= step) path.lineTo(x, h - jitter())
  path.lineTo(jitter(), h - jitter())
  for (let y = h - step; y > 0; y -= step) path.lineTo(jitter(), y)
  path.closePath()
  return path
}

let grain: HTMLCanvasElement | null = null

/** Shared 128² paper-grain tile (no readback: written with putImageData). */
function grainTile(): HTMLCanvasElement | null {
  if (grain) return grain
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) return null
  const image = g.createImageData(128, 128)
  const rand = random(0x9e3779b9)
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 96 + rand() * 64
    image.data[i] = value
    image.data[i + 1] = value
    image.data[i + 2] = value
    image.data[i + 3] = 40
  }
  g.putImageData(image, 0, 0)
  grain = canvas
  return grain
}

function paper(g: CanvasRenderingContext2D, w: number, h: number, rand: () => number): void {
  const tile = grainTile()
  const pattern = tile ? g.createPattern(tile, 'repeat') : null
  if (pattern) {
    g.save()
    g.globalCompositeOperation = 'overlay'
    g.fillStyle = pattern
    g.fillRect(0, 0, w, h)
    g.restore()
  }
  // A few fibres and scuffs.
  g.save()
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = rand() < 0.5 ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.07)'
    g.lineWidth = 1
    const x = rand() * w
    const y = rand() * h
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + 10 + rand() * 40, y + (rand() - 0.5) * 6)
    g.stroke()
  }
  for (let i = 0; i < 5; i++) {
    const edge = rand() < 0.5
    const x = edge ? (rand() < 0.5 ? rand() * 24 : w - rand() * 24) : rand() * w
    const y = edge ? rand() * h : rand() < 0.5 ? rand() * 10 : h - rand() * 10
    g.fillStyle = 'rgba(255, 255, 255, 0.16)'
    g.beginPath()
    g.ellipse(x, y, 3 + rand() * 10, 1.5 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

/** Darkened, rubbed rim along the outline (inside the clip). */
function wornRim(g: CanvasRenderingContext2D, outline: Path2D): void {
  g.save()
  g.strokeStyle = 'rgba(30, 20, 10, 0.24)'
  g.lineWidth = 7
  g.stroke(outline)
  g.strokeStyle = 'rgba(255, 255, 255, 0.10)'
  g.lineWidth = 2
  g.stroke(outline)
  g.restore()
}

function drawYears(g: CanvasRenderingContext2D, years: string, right: number, h: number, maxWidth: number, color: string): number {
  const fitted = fitLabelText(years.toUpperCase(), maxWidth, Math.round(h * 0.4), Math.round(h * 0.26), (text, size) => {
    g.font = font(400, size, FONT.osd)
    return g.measureText(text).width
  })
  g.font = font(400, fitted.size, FONT.osd)
  g.fillStyle = color
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  g.fillText(fitted.text, right, h * 0.53)
  return g.measureText(fitted.text).width
}

function drawTitle(g: StretchContext, title: string, left: number, maxWidth: number, h: number, color: string): void {
  let squeeze = 1
  const fitted = fitLabelText(title.toUpperCase(), maxWidth, Math.round(h * 0.6), Math.round(h * 0.34), (text, size) => {
    squeeze = setTitleFont(g, size)
    return g.measureText(text).width * squeeze
  })
  squeeze = setTitleFont(g, fitted.size)
  g.save()
  g.translate(left, h * 0.55)
  g.scale(squeeze, 1)
  g.fillStyle = color
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.fillText(fitted.text, 0, 0)
  g.restore()
  if ('fontStretch' in g) g.fontStretch = 'normal'
}

/** One label in its own space (w × h, physical aspect), clipped to its worn outline. */
export function drawLabel(g: CanvasRenderingContext2D, w: number, h: number, style: LabelStyle, tape: Tape | undefined): void {
  const rand = random(style.seed)
  const outline = wornOutline(w, h, rand)
  g.save()
  g.clip(outline)
  g.fillStyle = style.stock
  g.fillRect(0, 0, w, h)

  if (!tape) {
    // Blank: faint ruled lines and a stock number.
    g.strokeStyle = style.accent
    g.globalAlpha = 0.55
    g.lineWidth = 2
    for (const y of [h * 0.38, h * 0.68]) {
      g.beginPath()
      g.moveTo(w * 0.05, y)
      g.lineTo(w * 0.8, y)
      g.stroke()
    }
    g.globalAlpha = 1
    g.font = font(400, Math.round(h * 0.32), FONT.osd)
    g.fillStyle = style.ink
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    g.fillText('T-120', w * 0.96, h * 0.53)
  } else {
    const pad = h * 0.16
    let left = pad
    let right = w - pad
    if (style.variant === 'band') {
      const band = h * 0.95
      g.fillStyle = style.accent
      g.fillRect(0, 0, band, h)
      g.font = font(400, Math.round(h * 0.5), FONT.osd)
      g.fillStyle = style.stock
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(tape.slot).padStart(2, '0'), band / 2, h * 0.53)
      left = band + pad
    } else if (style.variant === 'rules') {
      g.fillStyle = style.accent
      g.fillRect(0, h * 0.1, w, h * 0.045)
      g.fillRect(0, h * 0.855, w, h * 0.045)
    } else {
      g.fillStyle = style.accent
      let x = w
      for (const width of [h * 0.34, h * 0.2, h * 0.11]) {
        x -= width
        g.fillRect(x, 0, width, h)
        x -= h * 0.08
      }
      right = x - pad * 0.5
    }
    let titleRight = right
    if (tape.years.trim()) {
      const yearsWidth = drawYears(g, tape.years.trim(), right, h, w * 0.3, style.ink)
      // Thin rule between the title and the years.
      const ruleX = right - yearsWidth - pad * 0.8
      g.fillStyle = style.ink
      g.globalAlpha = 0.6
      g.fillRect(ruleX, h * 0.22, 2, h * 0.56)
      g.globalAlpha = 1
      titleRight = ruleX - pad * 0.8
    }
    drawTitle(g, tape.title.trim(), left, titleRight - left, h, style.ink)
  }

  paper(g, w, h, rand)
  wornRim(g, outline)
  g.restore()
}

/**
 * Draws every label into its row. `aspect` is the physical width/height of a
 * spine label: rows are drawn in that proportion and squeezed into the row, so
 * the text is not distorted on the tape.
 */
export function drawLabelAtlas(canvas: HTMLCanvasElement, entries: readonly AtlasEntry[], aspect: number): void {
  const g = canvas.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, canvas.width, canvas.height)
  const styles = labelStyles(entries.flatMap(({ slot, tape }) => (tape ? [{ slot, id: tape.id }] : [])))
  const rowW = ATLAS_SIZE - ROW_PAD * 2
  const rowH = ROW_HEIGHT - ROW_PAD * 2
  const drawW = rowH * Math.max(1, aspect)
  for (const { slot, tape } of entries) {
    const style = (tape && styles.get(slot)) || { ...BLANK_STOCK, variant: 'rules' as const, seed: hashId(`blank-${slot}`) }
    g.save()
    g.translate(ROW_PAD, atlasRow(slot) * ROW_HEIGHT + ROW_PAD)
    g.scale(rowW / drawW, 1)
    drawLabel(g, drawW, rowH, style, tape)
    g.restore()
  }
}
