/**
 * TV light spill (plan §10.7), pure part: the screen canvas is sampled at 8×6,
 * averaged in linear light and damped; the result tints the desk glow card
 * and (greybox) a realtime spot.
 *
 * Brightness is the mean of linear R, G and B (radiant power), not Rec.709
 * luminance: luminance weights blue at 7%, which would make the saturated
 * blue INSERT TAPE screen barely glow, while a phosphor throws plenty of blue
 * light. A dark tape channel (white text on black) stays dim either way.
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/** Sample size (px) of the screen. */
export const SAMPLE_WIDTH = 8
export const SAMPLE_HEIGHT = 6
/** Seconds between samples (also re-sampled on a channel change). */
export const SAMPLE_INTERVAL = 0.2
/** Damping time constant (s) toward a new sample. */
export const GLOW_SMOOTH_TIME = 0.25
/** The CRT shader's HDR gain on the picture (crtScreen.ts, TV preset). */
export const SCREEN_BOOST = 1.4
/** Desk card gain and its per-channel cap (additive; keeps the desk far below the .88 bloom threshold). */
export const CARD_GAIN = 0.32
export const CARD_MAX_CHANNEL = 0.2

export function srgbByteToLinear(value: number): number {
  const s = value / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Mean linear colour of RGBA bytes (alpha ignored). */
export function averageLinear(data: ArrayLike<number>): Rgb {
  let r = 0
  let g = 0
  let b = 0
  const pixels = Math.floor(data.length / 4)
  if (pixels === 0) return BLACK
  for (let i = 0; i < pixels * 4; i += 4) {
    r += srgbByteToLinear(data[i] ?? 0)
    g += srgbByteToLinear(data[i + 1] ?? 0)
    b += srgbByteToLinear(data[i + 2] ?? 0)
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels }
}

/** Light leaving the glass for an averaged picture (×CRT boost). */
export function screenRadiance(average: Rgb, boost = SCREEN_BOOST): Rgb {
  return { r: average.r * boost, g: average.g * boost, b: average.b * boost }
}

export function power(color: Rgb): number {
  return (color.r + color.g + color.b) / 3
}

/** Hue at full value (white for black, so a zero-power light keeps a sane colour). */
export function chroma(color: Rgb): Rgb {
  const max = Math.max(color.r, color.g, color.b)
  return max > 1e-6 ? { r: color.r / max, g: color.g / max, b: color.b / max } : { r: 1, g: 1, b: 1 }
}

/** Exponential approach toward `target` (frame-rate independent); smoothTime 0 snaps. */
export function dampRgb(current: Rgb, target: Rgb, smoothTime: number, dt: number): Rgb {
  if (smoothTime <= 0) return target
  const k = 1 - Math.exp(-Math.max(0, dt) / smoothTime)
  return {
    r: current.r + (target.r - current.r) * k,
    g: current.g + (target.g - current.g) * k,
    b: current.b + (target.b - current.b) * k,
  }
}

/** Additive colour of the desk card for a screen radiance, capped per channel. */
export function cardColor(radiance: Rgb, gain = CARD_GAIN, cap = CARD_MAX_CHANNEL): Rgb {
  const c = { r: radiance.r * gain, g: radiance.g * gain, b: radiance.b * gain }
  const max = Math.max(c.r, c.g, c.b)
  const scale = max > cap ? cap / max : 1
  return { r: c.r * scale, g: c.g * scale, b: c.b * scale }
}
