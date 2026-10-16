import { describe, expect, it } from 'vitest'
import {
  applyMatrix3d,
  centeredQuad,
  coverPlacement,
  matrix3dCss,
  OSD_HEIGHT,
  OSD_WIDTH,
  parseCalibration,
  placePoint,
  quadToMatrix3d,
  stillMatchedFov,
  tvQuad,
  type Point,
  type StillCalibration,
} from './still'

const CALIBRATION: StillCalibration = {
  width: 1920,
  height: 1080,
  fov: 32,
  tv: [
    [812.4, 402.1],
    [1131.9, 409.6],
    [1126.3, 650.2],
    [818.7, 642.8],
  ],
}

const RECT: readonly Point[] = [
  [0, 0],
  [OSD_WIDTH, 0],
  [OSD_WIDTH, OSD_HEIGHT],
  [0, OSD_HEIGHT],
]

function expectPoint(actual: Point, expected: Point, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits)
  expect(actual[1]).toBeCloseTo(expected[1], digits)
}

describe('coverPlacement (object-fit: cover, centred)', () => {
  it('is the identity when the viewport matches the still', () => {
    expect(coverPlacement(1920, 1080, 1920, 1080)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('crops top and bottom on a wider viewport', () => {
    const placement = coverPlacement(2000, 900, 1920, 1080)
    expect(placement.scale).toBeCloseTo(2000 / 1920)
    expect(placement.x).toBeCloseTo(0)
    expect(placement.y).toBeCloseTo((900 - 1080 * (2000 / 1920)) / 2)
  })

  it('crops the sides on a phone', () => {
    const placement = coverPlacement(390, 844, 1920, 1080)
    expect(placement.scale).toBeCloseTo(844 / 1080)
    expect(placement.y).toBeCloseTo(0)
    expect(placement.x).toBeCloseTo((390 - 1920 * (844 / 1080)) / 2)
    // The still's centre stays the viewport's centre.
    expectPoint(placePoint([960, 540], placement), [195, 422])
  })

  it('maps the calibrated TV corners into the viewport', () => {
    const quad = tvQuad(CALIBRATION, 960, 540)
    CALIBRATION.tv.forEach((corner, i) => expectPoint(quad[i] ?? [0, 0], [corner[0] / 2, corner[1] / 2]))
  })
})

describe('quadToMatrix3d (rectangle → TV glass)', () => {
  it('maps the OSD corners onto a perspective quad', () => {
    const quad = tvQuad(CALIBRATION, 1440, 900)
    const matrix = quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, quad)
    expect(matrix).not.toBeNull()
    if (!matrix) return
    expect(matrix).toHaveLength(16)
    RECT.forEach((corner, i) => expectPoint(applyMatrix3d(matrix, corner), quad[i] ?? [0, 0], 4))
  })

  it('maps the box centre to the crossing of the quad diagonals (projective, not bilinear)', () => {
    const quad: Point[] = [
      [100, 80],
      [520, 120],
      [480, 400],
      [140, 330],
    ]
    const matrix = quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, quad)
    expect(matrix).not.toBeNull()
    if (!matrix) return
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad as [Point, Point, Point, Point]
    // Intersection of the diagonals p0→p2 and p1→p3.
    const den = (x0 - x2) * (y1 - y3) - (y0 - y2) * (x1 - x3)
    const a = x0 * y2 - y0 * x2
    const b = x1 * y3 - y1 * x3
    const cross: Point = [(a * (x1 - x3) - (x0 - x2) * b) / den, (a * (y1 - y3) - (y0 - y2) * b) / den]
    expectPoint(applyMatrix3d(matrix, [OSD_WIDTH / 2, OSD_HEIGHT / 2]), cross, 4)
  })

  it('is affine (no perspective terms) for a rectangle', () => {
    const quad = centeredQuad(1280, 720)
    const matrix = quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, quad)
    expect(matrix).not.toBeNull()
    if (!matrix) return
    expect(matrix[3]).toBe(0)
    expect(matrix[7]).toBe(0)
    RECT.forEach((corner, i) => expectPoint(applyMatrix3d(matrix, corner), quad[i] ?? [0, 0]))
    expect(matrix3dCss(matrix)).toMatch(/^matrix3d\((-?[\d.e-]+,){15}-?[\d.e-]+\)$/)
  })

  it('rejects degenerate quads and boxes', () => {
    const line: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ]
    expect(quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, line)).toBeNull()
    expect(quadToMatrix3d(0, OSD_HEIGHT, centeredQuad(800, 600))).toBeNull()
    expect(quadToMatrix3d(OSD_WIDTH, OSD_HEIGHT, [[0, 0]])).toBeNull()
  })
})

describe('stillMatchedFov', () => {
  const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
    [1920, 1080],
    [1920, 947],
    [1440, 900],
    [2560, 1080],
    [390, 844],
    [768, 1024],
  ]

  it('equals the capture FOV whenever the still is scaled by its height', () => {
    expect(stillMatchedFov(1920, 1080, CALIBRATION)).toBeCloseTo(32)
    expect(stillMatchedFov(960, 540, CALIBRATION)).toBeCloseTo(32)
    expect(stillMatchedFov(1440, 900, CALIBRATION)).toBeCloseTo(32)
    expect(stillMatchedFov(390, 844, CALIBRATION)).toBeCloseTo(32)
    // Wider than 16:9: cover crops top/bottom, so the lens narrows.
    expect(stillMatchedFov(1920, 947, CALIBRATION)).toBeLessThan(32)
  })

  it('projects every still pixel where the cover-placed still shows it', () => {
    for (const [width, height] of VIEWPORTS) {
      const placement = coverPlacement(width, height, CALIBRATION.width, CALIBRATION.height)
      const stillFocal = CALIBRATION.height / 2 / Math.tan((CALIBRATION.fov * Math.PI) / 360)
      const viewFocal = height / 2 / Math.tan((stillMatchedFov(width, height, CALIBRATION) * Math.PI) / 360)
      for (const point of [...CALIBRATION.tv, [0, 0] as Point, [1920, 1080] as Point]) {
        // Direction of the pixel from the still camera, re-projected by the viewport camera.
        const tx = (point[0] - CALIBRATION.width / 2) / stillFocal
        const ty = (point[1] - CALIBRATION.height / 2) / stillFocal
        expectPoint([width / 2 + tx * viewFocal, height / 2 + ty * viewFocal], placePoint(point, placement), 6)
      }
    }
  })
})

describe('parseCalibration', () => {
  it('accepts the capture output', () => {
    expect(parseCalibration(JSON.parse(JSON.stringify(CALIBRATION)))).toEqual(CALIBRATION)
  })

  it('rejects anything malformed', () => {
    expect(parseCalibration(undefined)).toBeNull()
    expect(parseCalibration({})).toBeNull()
    expect(parseCalibration({ ...CALIBRATION, width: 0 })).toBeNull()
    expect(parseCalibration({ ...CALIBRATION, fov: 200 })).toBeNull()
    expect(parseCalibration({ ...CALIBRATION, tv: CALIBRATION.tv.slice(0, 3) })).toBeNull()
    expect(parseCalibration({ ...CALIBRATION, tv: [[1, 2], [3, 4], [5, 6], [7, 'x']] })).toBeNull()
  })
})

describe('centeredQuad (free mode)', () => {
  it('is a 4:3 screen inside the viewport, never wider than the OSD box', () => {
    for (const [width, height] of [
      [1920, 1080],
      [390, 844],
      [3840, 2160],
    ] as const) {
      const [[left, top], [right], [, bottom]] = centeredQuad(width, height) as [Point, Point, Point, Point]
      expect((right - left) / (bottom - top)).toBeCloseTo(4 / 3)
      expect(right - left).toBeLessThanOrEqual(OSD_WIDTH)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeLessThanOrEqual(width)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(bottom).toBeLessThanOrEqual(height)
    }
  })
})
