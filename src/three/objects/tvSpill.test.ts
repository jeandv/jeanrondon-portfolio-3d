import { describe, expect, it } from 'vitest'
import {
  averageLinear,
  CARD_MAX_CHANNEL,
  cardColor,
  chroma,
  dampRgb,
  power,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  screenRadiance,
  srgbByteToLinear,
  type Rgb,
} from './tvSpill'

/** An 8×6 RGBA sample filled with one sRGB colour, plus optional "text" pixels. */
function sample(fill: [number, number, number], text: { color: [number, number, number]; pixels: number } | null = null) {
  const data = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4)
  for (let i = 0; i < SAMPLE_WIDTH * SAMPLE_HEIGHT; i++) {
    const color = text && i < text.pixels ? text.color : fill
    data.set([...color, 255], i * 4)
  }
  return data
}

const VCR_BLUE: [number, number, number] = [0x00, 0x00, 0xaa]

describe('TV glow colour', () => {
  it('averages in linear light', () => {
    expect(srgbByteToLinear(0)).toBe(0)
    expect(srgbByteToLinear(255)).toBeCloseTo(1)
    const half = averageLinear(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))
    expect(half.r).toBeCloseTo(0.5)
    expect(averageLinear(new Uint8ClampedArray())).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('blue INSERT TAPE throws a blue cast; a dark tape channel barely glows', () => {
    const blue = screenRadiance(averageLinear(sample(VCR_BLUE)))
    const dark = screenRadiance(averageLinear(sample([4, 4, 6], { color: [255, 255, 255], pixels: 3 })))
    const hue = chroma(blue)
    expect(hue.b).toBe(1)
    expect(hue.r).toBeLessThan(0.05)
    expect(power(blue)).toBeGreaterThan(power(dark) * 2)
    expect(power(dark)).toBeLessThan(0.1)
  })

  it('caps the additive desk card per channel (no bloom on the desk)', () => {
    const white: Rgb = { r: 1.4, g: 1.4, b: 1.4 }
    const card = cardColor(white)
    expect(Math.max(card.r, card.g, card.b)).toBeCloseTo(CARD_MAX_CHANNEL)
    const blue = cardColor(screenRadiance(averageLinear(sample(VCR_BLUE))))
    expect(blue.b).toBeGreaterThan(blue.r * 10)
    expect(blue.b).toBeLessThanOrEqual(CARD_MAX_CHANNEL)
  })

  it('damps toward a new sample, frame-rate independently, and snaps with smoothTime 0', () => {
    const target: Rgb = { r: 0, g: 0, b: 1 }
    let atSixty: Rgb = { r: 0, g: 0, b: 0 }
    for (let i = 0; i < 30; i++) atSixty = dampRgb(atSixty, target, 0.25, 1 / 60)
    let atThirty: Rgb = { r: 0, g: 0, b: 0 }
    for (let i = 0; i < 15; i++) atThirty = dampRgb(atThirty, target, 0.25, 1 / 30)
    expect(atSixty.b).toBeCloseTo(atThirty.b, 6)
    expect(atSixty.b).toBeGreaterThan(0.8)
    expect(atSixty.b).toBeLessThan(1)
    // Monotonic approach, never overshooting.
    let value: Rgb = { r: 0, g: 0, b: 0 }
    for (let i = 0; i < 200; i++) {
      const next = dampRgb(value, target, 0.25, 1 / 60)
      expect(next.b).toBeGreaterThanOrEqual(value.b)
      expect(next.b).toBeLessThanOrEqual(1)
      value = next
    }
    expect(dampRgb({ r: 0, g: 0, b: 0 }, target, 0, 1 / 60)).toEqual(target)
  })
})
