import { describe, expect, it } from 'vitest'
import { random } from '../tapes/labelAtlas'
import { coronaRays, ensoPath, glitchBands, halftoneRadius, rainStreaks, trackedPositions } from './art'
import { MARK_BOX, MARKS } from './marks'

describe('poster art helpers (deterministic)', () => {
  it('gives the same corona, ensō, glitch and rain for the same seed', () => {
    expect(coronaRays(random(7), 40)).toEqual(coronaRays(random(7), 40))
    expect(ensoPath(random(7))).toEqual(ensoPath(random(7)))
    expect(glitchBands(random(7), 10, 800, 30)).toEqual(glitchBands(random(7), 10, 800, 30))
    expect(rainStreaks(random(7), 50, 400, 300, 0.1, 20)).toEqual(rainStreaks(random(7), 50, 400, 300, 0.1, 20))
    expect(coronaRays(random(7), 40)).not.toEqual(coronaRays(random(8), 40))
  })

  it('keeps the corona outside the black sun, some streamers long', () => {
    const rays = coronaRays(random(3), 64)
    expect(rays).toHaveLength(64)
    for (const ray of rays) {
      expect(ray.to).toBeGreaterThan(ray.from)
      expect(ray.from).toBeGreaterThan(0.9)
      expect(ray.alpha).toBeGreaterThan(0)
      expect(ray.alpha).toBeLessThanOrEqual(0.8)
    }
    expect(rays.some((ray) => ray.to > 2)).toBe(true)
  })

  it('draws an open ensō: heavy start, thin end, a gap', () => {
    const path = ensoPath(random(11))
    const first = path[0]
    const last = path.at(-1)
    if (!first || !last) throw new Error('empty ensō')
    const widths = path.map((point) => point.width)
    expect(Math.max(...widths.slice(0, 60))).toBeGreaterThan(Math.max(...widths.slice(-30)) * 2)
    for (const point of path) expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 0)
    // The ends do not meet.
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(0.3)
  })

  it('keeps glitch bands and rain inside the sheet', () => {
    for (const band of glitchBands(random(5), 30, 600, 40)) {
      expect(band.y).toBeGreaterThanOrEqual(0)
      expect(band.y + band.h).toBeLessThanOrEqual(600)
      expect(Math.abs(band.dx)).toBeLessThanOrEqual(40)
    }
    for (const streak of rainStreaks(random(5), 100, 300, 200, 0.12, 25)) {
      for (const x of [streak.x0, streak.x1]) expect(x).toBeGreaterThanOrEqual(0)
      for (const x of [streak.x0, streak.x1]) expect(x).toBeLessThanOrEqual(300)
      for (const y of [streak.y0, streak.y1]) expect(y).toBeLessThanOrEqual(200)
      expect(streak.y1).toBeGreaterThanOrEqual(streak.y0)
    }
  })

  it('grows halftone dots with darkness until they touch', () => {
    expect(halftoneRadius(0, 10)).toBe(0)
    expect(halftoneRadius(0.5, 10)).toBeGreaterThan(halftoneRadius(0.2, 10))
    // Area-true: a full-dark cell is covered by a dot of area cell².
    expect(halftoneRadius(1, 10)).toBeCloseTo(Math.sqrt(1 / Math.PI) * 10)
    expect(halftoneRadius(1, 10)).toBeLessThanOrEqual(6.2)
    expect(halftoneRadius(5, 10)).toBe(halftoneRadius(1, 10))
  })

  it('lays out wide tracking', () => {
    expect(trackedPositions([10, 10, 10], 5)).toEqual({ xs: [0, 15, 30], width: 40 })
  })
})

describe('tech poster marks (Simple Icons, CC0)', () => {
  it('ships path data and the brand colours for TypeScript, JavaScript, React and Next.js', () => {
    expect(MARK_BOX).toBe(24)
    expect(MARKS.typescript.hex.toUpperCase()).toBe('3178C6')
    expect(MARKS.javascript.hex.toUpperCase()).toBe('F7DF1E')
    expect(MARKS.react.hex.toUpperCase()).toBe('61DAFB')
    for (const mark of Object.values(MARKS)) expect(mark.path).toMatch(/^M/)
  })
})
