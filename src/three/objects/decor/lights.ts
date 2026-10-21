/**
 * The room's small lights (pure, three-free): warm fairy lights draped along
 * the window sill (bulbs on a catenary between ties) and one LED strip
 * behind the desk whose colour a click cycles. Cosy, not a gaming rig: only
 * the fairy bulbs' cores reach the bloom threshold; the LED stays under it
 * and its spill is faked with additive glow cards (realtime lights never
 * touch baked materials).
 */

export type Vec3 = readonly [number, number, number]

/** Height (≤ 0) of a hanging wire at t ∈ [0, 1] of a span that sags `sag` m in the middle (a true catenary, shape `k`). */
export function catenary(t: number, sag: number, k = 1.4): number {
  const x = k * (2 * t - 1)
  return (-sag * (Math.cosh(k) - Math.cosh(x))) / (Math.cosh(k) - 1)
}

export interface FairySpec {
  /** Wire ends (m, world) and the tie points' spacing along x. */
  readonly from: number
  readonly to: number
  /** World y of the ties (on the sill's front edge) and z of the hanging wire. */
  readonly y: number
  readonly z: number
  readonly tieSpacing: number
  readonly sag: number
  /** Distance between bulbs along x. */
  readonly bulbSpacing: number
  /** Bulb radius (m). */
  readonly bulb: number
}

/** Along the front edge of the greybox window sill (x −1.45…1.05, top 0.95, front z −0.32). */
export const FAIRY: FairySpec = {
  from: -1.38,
  to: 0.98,
  y: 0.954,
  z: -0.314,
  tieSpacing: 0.295,
  sag: 0.03,
  bulbSpacing: 0.062,
  bulb: 0.0055,
}

/** Wire height at world x (the ties sit on the sill, each span sags between them). */
export function fairyWireY(x: number, spec: FairySpec = FAIRY): number {
  const spans = Math.max(1, Math.round((spec.to - spec.from) / spec.tieSpacing))
  const span = (spec.to - spec.from) / spans
  const local = Math.min(spans - 1e-9, Math.max(0, (x - spec.from) / span))
  return spec.y + catenary(local - Math.floor(local), spec.sag)
}

/** Points of the wire (for its thin tube), `perSpan` segments per span. */
export function fairyWire(spec: FairySpec = FAIRY, perSpan = 8): Vec3[] {
  const spans = Math.max(1, Math.round((spec.to - spec.from) / spec.tieSpacing))
  const count = spans * perSpan
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = spec.from + ((spec.to - spec.from) * i) / count
    return [x, fairyWireY(x, spec), spec.z] as const
  })
}

export interface Bulb {
  readonly position: Vec3
  /** Twinkle phase (rad) and rate (rad/s). */
  readonly phase: number
  readonly rate: number
}

/** Bulbs hang a hair under the wire; phases from a fixed hash (deterministic). */
export function fairyBulbs(spec: FairySpec = FAIRY): Bulb[] {
  const count = Math.floor((spec.to - spec.from) / spec.bulbSpacing) + 1
  const offset = (spec.to - spec.from - (count - 1) * spec.bulbSpacing) / 2
  return Array.from({ length: count }, (_, i) => {
    const x = spec.from + offset + i * spec.bulbSpacing
    const hash = Math.abs(Math.sin(i * 12.9898 + 4.1414) * 43758.5453) % 1
    return {
      position: [x, fairyWireY(x, spec) - spec.bulb * 1.2, spec.z + 0.002] as const,
      phase: hash * Math.PI * 2,
      rate: 0.6 + ((hash * 7.31) % 1) * 1.1,
    }
  })
}

/** Bulb brightness (0..1 scale of the core) at time t: a gentle twinkle; `still` (reduced motion, capture) holds it. */
export function twinkle(bulb: Bulb, t: number, still: boolean): number {
  if (still) return 0.92
  const slow = Math.sin(t * bulb.rate + bulb.phase)
  const flicker = Math.sin(t * bulb.rate * 3.7 + bulb.phase * 2.3)
  return 0.84 + 0.12 * slow + 0.04 * flicker
}

/** Linear HDR core colour of a lit fairy bulb (~2200 K): over the bloom threshold (0.88), only the core. */
export const FAIRY_CORE = { r: 2.3, g: 1.45, b: 0.62 } as const

/* ------------------------------------------------------------------ */
/* LED strip                                                            */
/* ------------------------------------------------------------------ */

export type LedId = 'violet' | 'teal' | 'amber' | 'off'

export interface LedColor {
  readonly id: LedId
  /** Tooltip / dev signal. */
  readonly label: string
  /** sRGB; null = off. */
  readonly hex: string | null
}

/** The cycle a click walks: violet → teal → warm amber → off → violet. */
export const LED_COLORS: readonly LedColor[] = [
  { id: 'violet', label: 'VIOLET', hex: '#9a5cff' },
  { id: 'teal', label: 'TEAL', hex: '#2fd0c4' },
  { id: 'amber', label: 'AMBER', hex: '#ffa449' },
  { id: 'off', label: 'OFF', hex: null },
]

export function ledColor(id: LedId): LedColor {
  return LED_COLORS.find((color) => color.id === id) ?? LED_COLORS[0]!
}

export function nextLed(id: LedId): LedId {
  const index = LED_COLORS.findIndex((color) => color.id === id)
  return LED_COLORS[(index + 1) % LED_COLORS.length]?.id ?? 'violet'
}

/** Slow breathing (s per breath) and its depth; reduced motion / capture hold the mid level. */
export const LED_BREATH = { period: 7, depth: 0.22 } as const

export function ledBreath(t: number, still: boolean): number {
  if (still) return 1
  return 1 - LED_BREATH.depth * 0.5 * (1 + Math.sin((t / LED_BREATH.period) * Math.PI * 2))
}

/** With the lamp off the small lights read more (×, lamp mix 0 on … 1 off). */
export function lampOffBoost(mix: number): number {
  return 1 + 0.45 * Math.min(1, Math.max(0, mix))
}

export interface LedSpec {
  /** Strip ends (x), its centre height and its face's z (on the wall, just above the desk top). */
  readonly from: number
  readonly to: number
  readonly y: number
  readonly z: number
  readonly height: number
  /** Wall glow card: up to `top`, a little off the wall (it lights the banner there too). */
  readonly wallTop: number
  readonly wallZ: number
  /** Desk glow card: from the desk's back edge forward. */
  readonly deskY: number
  readonly deskFrom: number
  readonly deskTo: number
}

/** Behind the greybox desk (x −0.75…0.85, top 0.75, back edge z −0.38; wall face −0.40; sill underside 0.935). */
export const LED: LedSpec = {
  from: -0.73,
  to: 0.83,
  y: 0.757,
  z: -0.3955,
  height: 0.01,
  wallTop: 0.933,
  wallZ: -0.388,
  deskY: 0.7515,
  deskFrom: -0.38,
  deskTo: -0.26,
}

/** Linear strip colour scale: the strip glows, it never flares (luma stays under the bloom threshold). */
export const LED_LEVEL = { core: 0.85, spill: 0.55 } as const
