/**
 * Seven-segment LCD digits drawn as polygons (no font involved, so nothing can
 * fall back): the CD player's track and time, the calculator's readout.
 * Segment bits: a 1 (top), b 2 (top right), c 4 (bottom right), d 8 (bottom),
 * e 16 (bottom left), f 32 (top left), g 64 (middle).
 */

export const SEGMENT_MASKS: Readonly<Record<string, number>> = {
  '0': 0x3f,
  '1': 0x06,
  '2': 0x5b,
  '3': 0x4f,
  '4': 0x66,
  '5': 0x6d,
  '6': 0x7d,
  '7': 0x07,
  '8': 0x7f,
  '9': 0x6f,
  '-': 0x40,
  ' ': 0,
  E: 0x79,
  r: 0x50,
  o: 0x5c,
  O: 0x3f,
  P: 0x73,
  n: 0x54,
  L: 0x38,
  H: 0x76,
  h: 0x74,
  A: 0x77,
  d: 0x5e,
  C: 0x39,
  U: 0x3e,
  t: 0x78,
}

export function segmentMask(char: string): number {
  return SEGMENT_MASKS[char] ?? 0
}

export interface SegmentCell {
  readonly mask: number
  /** Decimal point lit after this digit. */
  readonly dp: boolean
}

/**
 * Cells for a readout, right-aligned in `count` cells: a `.` lights the
 * point of the digit before it (a leading `.` reads `0.`); `pointOnLast`
 * lights the last digit's point when there is none (calculator style: `42.`).
 */
export function segmentCells(text: string, count: number, pointOnLast = false): SegmentCell[] {
  const cells: { mask: number; dp: boolean }[] = []
  for (const char of text) {
    if (char === '.') {
      const last = cells.at(-1)
      if (last) last.dp = true
      else cells.push({ mask: segmentMask('0'), dp: true })
    } else {
      cells.push({ mask: segmentMask(char), dp: false })
    }
  }
  if (pointOnLast && !cells.some((cell) => cell.dp)) {
    const last = cells.at(-1)
    if (last) last.dp = true
  }
  const shown = cells.slice(-count)
  return [...Array.from({ length: count - shown.length }, () => ({ mask: 0, dp: false })), ...shown]
}

export interface SegmentStyle {
  readonly on: string
  /** Unlit segments (a real LCD shows them faintly); null hides them. */
  readonly off: string | null
  /** Segment thickness as a share of the cell width. */
  readonly thickness?: number
  /** Italic lean (px of x shift per px of height). */
  readonly slant?: number
}

type Point = readonly [number, number]

/** The seven segment polygons of a cell (x, y = top-left, w × h), unslanted. */
function segmentPolygons(x: number, y: number, w: number, h: number, t: number): Point[][] {
  const half = t / 2
  const gap = Math.max(1, t * 0.18)
  const mid = y + h / 2
  const horizontal = (cy: number): Point[] => [
    [x + half + gap, cy],
    [x + t + gap, cy - half],
    [x + w - t - gap, cy - half],
    [x + w - half - gap, cy],
    [x + w - t - gap, cy + half],
    [x + t + gap, cy + half],
  ]
  const vertical = (cx: number, y0: number, y1: number): Point[] => [
    [cx, y0 + gap],
    [cx + half, y0 + half + gap],
    [cx + half, y1 - half - gap],
    [cx, y1 - gap],
    [cx - half, y1 - half - gap],
    [cx - half, y0 + half + gap],
  ]
  return [
    horizontal(y + half),
    vertical(x + w - half, y + half, mid),
    vertical(x + w - half, mid, y + h - half),
    horizontal(y + h - half),
    vertical(x + half, mid, y + h - half),
    vertical(x + half, y + half, mid),
    horizontal(mid),
  ]
}

function fillPolygon(g: CanvasRenderingContext2D, points: readonly Point[], slant: number, baseY: number): void {
  g.beginPath()
  points.forEach(([px, py], i) => {
    const sx = px + (baseY - py) * slant
    if (i === 0) g.moveTo(sx, py)
    else g.lineTo(sx, py)
  })
  g.closePath()
  g.fill()
}

/** Draws one digit cell (and its decimal point). */
export function drawSegmentCell(g: CanvasRenderingContext2D, cell: SegmentCell, x: number, y: number, w: number, h: number, style: SegmentStyle): void {
  const t = w * (style.thickness ?? 0.18)
  const slant = style.slant ?? 0.08
  const base = y + h
  segmentPolygons(x, y, w, h, t).forEach((points, bit) => {
    const lit = (cell.mask & (1 << bit)) !== 0
    if (!lit && style.off === null) return
    g.fillStyle = lit ? style.on : (style.off ?? style.on)
    fillPolygon(g, points, slant, base)
  })
  if (cell.dp || style.off !== null) {
    g.fillStyle = cell.dp ? style.on : (style.off ?? style.on)
    const r = t * 0.62
    g.beginPath()
    g.arc(x + w + r * 0.9, y + h - r, r, 0, Math.PI * 2)
    g.fill()
  }
}

/** Draws a row of cells starting at `x`, each `w` wide with `pitch` px between cell origins. */
export function drawSegments(
  g: CanvasRenderingContext2D,
  cells: readonly SegmentCell[],
  x: number,
  y: number,
  w: number,
  h: number,
  pitch: number,
  style: SegmentStyle,
): void {
  cells.forEach((cell, i) => drawSegmentCell(g, cell, x + i * pitch, y, w, h, style))
}

/** `m:ss` for the CD player (minutes unpadded, up to 99). */
export function formatTrackTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.min(99, Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`
}
