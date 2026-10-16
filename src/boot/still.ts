/**
 * The loader still (public/still.jpg) and the geometry that lays the DOM OSD
 * onto its TV glass. scripts/capture-still.mjs renders the home view once and
 * writes src/assets/still-calibration.json: the still size, the camera's
 * vertical FOV and the TV screen's 4 corners (TL, TR, BR, BL) in still pixels.
 */

export type Point = readonly [x: number, y: number]

export interface StillCalibration {
  readonly width: number
  readonly height: number
  /** Vertical FOV (deg) the still was rendered with. */
  readonly fov: number
  /** TV glass corners in still pixels: top-left, top-right, bottom-right, bottom-left. */
  readonly tv: readonly [Point, Point, Point, Point]
}

/** Logical size of the OSD element; the transform maps it onto the glass. */
export const OSD_WIDTH = 640
export const OSD_HEIGHT = 480

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber)
}

/** Validates the calibration JSON (null when absent or malformed). */
export function parseCalibration(value: unknown): StillCalibration | null {
  if (!value || typeof value !== 'object') return null
  const { width, height, fov, tv } = value as Record<string, unknown>
  if (!isNumber(width) || !isNumber(height) || width <= 0 || height <= 0) return null
  if (!isNumber(fov) || fov <= 0 || fov >= 180) return null
  if (!Array.isArray(tv) || tv.length !== 4 || !tv.every(isPoint)) return null
  const [a, b, c, d] = tv as Point[]
  if (!a || !b || !c || !d) return null
  return { width, height, fov, tv: [a, b, c, d] }
}

// A glob, so a missing file (first run, capture failed) is "no calibration", not a build error.
const CALIBRATION_FILES = import.meta.glob<unknown>('../assets/still-calibration.json', { eager: true, import: 'default' })

export const STILL_CALIBRATION: StillCalibration | null = parseCalibration(Object.values(CALIBRATION_FILES)[0])

/* ------------------------------------------------------------------ */
/* object-fit: cover                                                    */
/* ------------------------------------------------------------------ */

export interface Placement {
  /** Image px → viewport px. */
  readonly scale: number
  /** Viewport position of the image's top-left corner (negative when cropped). */
  readonly x: number
  readonly y: number
}

/** Where `object-fit: cover; object-position: 50% 50%` puts an image in a viewport. */
export function coverPlacement(viewWidth: number, viewHeight: number, imageWidth: number, imageHeight: number): Placement {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight)
  return { scale, x: (viewWidth - imageWidth * scale) / 2, y: (viewHeight - imageHeight * scale) / 2 }
}

/** An image-pixel point in viewport px. */
export function placePoint([x, y]: Point, placement: Placement): Point {
  return [placement.x + x * placement.scale, placement.y + y * placement.scale]
}

/** The calibrated TV corners in viewport px for the cover-placed still. */
export function tvQuad(calibration: StillCalibration, viewWidth: number, viewHeight: number): Point[] {
  const placement = coverPlacement(viewWidth, viewHeight, calibration.width, calibration.height)
  return calibration.tv.map((point) => placePoint(point, placement))
}

/**
 * Vertical FOV (deg) that makes the 3D camera frame exactly the cover-placed
 * still: the viewport shows H/scale still pixels vertically, and the still's
 * focal length is (height/2)/tan(fov/2). Same camera pose, square pixels.
 */
export function stillMatchedFov(viewWidth: number, viewHeight: number, calibration: StillCalibration): number {
  const { scale } = coverPlacement(viewWidth, viewHeight, calibration.width, calibration.height)
  const tanHalf = (viewHeight / (scale * calibration.height)) * Math.tan((calibration.fov * Math.PI) / 360)
  return (2 * Math.atan(tanHalf) * 180) / Math.PI
}

/* ------------------------------------------------------------------ */
/* Rectangle → quad (CSS matrix3d)                                      */
/* ------------------------------------------------------------------ */

/**
 * Projective map of a `width`×`height` box (transform-origin 0 0) onto a quad
 * (TL, TR, BR, BL), as the 16 column-major values of a CSS matrix3d. Heckbert's
 * square→quad solution, then scaled from the unit square to the box. Null for
 * a degenerate quad.
 */
export function quadToMatrix3d(width: number, height: number, quad: readonly Point[]): number[] | null {
  const [p0, p1, p2, p3] = quad
  if (!p0 || !p1 || !p2 || !p3 || width <= 0 || height <= 0) return null
  const [x0, y0] = p0
  const [x1, y1] = p1
  const [x2, y2] = p2
  const [x3, y3] = p3
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  let a: number, b: number, d: number, e: number, g: number, h: number
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Parallelogram: affine.
    a = x1 - x0
    b = x2 - x1
    d = y1 - y0
    e = y2 - y1
    g = 0
    h = 0
  } else {
    const dx1 = x1 - x2
    const dx2 = x3 - x2
    const dy1 = y1 - y2
    const dy2 = y3 - y2
    const den = dx1 * dy2 - dx2 * dy1
    if (Math.abs(den) < 1e-9) return null
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
    a = x1 - x0 + g * x1
    b = x3 - x0 + h * x3
    d = y1 - y0 + g * y1
    e = y3 - y0 + h * y3
  }
  const values = [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1]
  return values.every(Number.isFinite) ? values : null
}

/** Applies a matrix3d (column-major) to a 2D point, with the perspective divide. */
export function applyMatrix3d(m: readonly number[], [x, y]: Point): Point {
  const at = (index: number) => m[index] ?? 0
  const w = at(3) * x + at(7) * y + at(15)
  return [(at(0) * x + at(4) * y + at(12)) / w, (at(1) * x + at(5) * y + at(13)) / w]
}

export function matrix3dCss(m: readonly number[]): string {
  return `matrix3d(${m.map((value) => Number(value.toPrecision(10))).join(',')})`
}

/** "Free" OSD: a 4:3 screen centred a little above the middle, never wider than the OSD box. */
export function centeredQuad(viewWidth: number, viewHeight: number): Point[] {
  const width = Math.min(viewWidth * 0.82, ((viewHeight * 0.58) * OSD_WIDTH) / OSD_HEIGHT, OSD_WIDTH)
  const height = (width * OSD_HEIGHT) / OSD_WIDTH
  const left = (viewWidth - width) / 2
  const top = viewHeight * 0.47 - height / 2
  return [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ]
}
