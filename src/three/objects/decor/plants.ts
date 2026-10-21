import { PLANT_PREFIX } from '../../contract'
import { random } from '../tapes/labelAtlas'

/**
 * Procedural potted plants (pure, three-free): a monstera in the back-left
 * corner, a snake plant on the right wall (the right corner, beside the PC
 * chest, under the posters) and a trailing pothos on the desk's back-right corner. Each plant is a pot plus leaf instances (all the
 * leaves of every plant share one instanced mesh; the pots, stems and vines
 * one static mesh). Deterministic: everything comes from the plant's seed.
 * A Blender `plant_<id>` node replaces the generated plant.
 */

export type Vec3 = readonly [number, number, number]

/** A Blender node that replaces a generated plant (contract.ts). */
export const plantNodeName = (id: string) => `${PLANT_PREFIX}${id}`

/** Leaf shapes in the leaf atlas (decor/leafAtlas.ts): its columns. */
export const LEAF_SHAPE = { monstera: 0, pothos: 1, blade: 2 } as const
export const LEAF_SHAPES = 3

export type PlantKind = 'monstera' | 'snake' | 'pothos'

export interface PlantSpec {
  readonly id: string
  readonly kind: PlantKind
  /** Centre of the pot's base (world). */
  readonly base: Vec3
  readonly pot: { readonly radius: number; readonly height: number; readonly color: string }
  readonly seed: number
}

export const PLANTS: readonly PlantSpec[] = [
  { id: 'monstera', kind: 'monstera', base: [-2.28, 0, -0.04], pot: { radius: 0.17, height: 0.3, color: '#b0623e' }, seed: 0x6d6f6e },
  // Right wall, between the two posters (the PC chest hides the back corner itself from every view).
  { id: 'snake', kind: 'snake', base: [2.36, 0, 0.6], pot: { radius: 0.12, height: 0.25, color: '#d8d2c4' }, seed: 0x736e6b },
  { id: 'pothos', kind: 'pothos', base: [0.768, 0.75, -0.27], pot: { radius: 0.052, height: 0.08, color: '#8c4f35' }, seed: 0x706f74 },
]

export interface Leaf {
  /** Where the leaf's stalk meets it (world). */
  readonly position: Vec3
  /** Unit vector along the leaf (base → tip). */
  readonly direction: Vec3
  /** Unit vector the leaf's face looks toward (roughly). */
  readonly facing: Vec3
  readonly length: number
  readonly width: number
  readonly shape: number
  /** Curl toward the face along the leaf (in leaf widths at the tip). */
  readonly bend: number
  /** Sway weight (0 still … 1) and its phase / rate. */
  readonly sway: number
  readonly phase: number
  readonly rate: number
  /** Linear tint multiplier per channel (variety). */
  readonly tint: Vec3
}

/** A stalk / vine segment (thin tube) from a to b. */
export interface Stem {
  readonly a: Vec3
  readonly b: Vec3
  readonly radius: number
}

export interface Plant {
  readonly spec: PlantSpec
  readonly leaves: readonly Leaf[]
  readonly stems: readonly Stem[]
}

type Rand = () => number

const norm = (v: readonly [number, number, number]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

const along = (p: Vec3, d: Vec3, s: number): Vec3 => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]

const green = (rand: Rand, light: number): Vec3 => {
  const k = 0.85 + rand() * 0.25
  return [k * (0.92 + light * 0.1), k * (1 + light * 0.08), k * (0.9 + rand() * 0.1)]
}

/** Monstera: big split leaves on long stalks fanning out of the pot (kept off the walls). */
function monstera(spec: PlantSpec, rand: Rand): Plant {
  const [bx, by, bz] = spec.base
  const soil: Vec3 = [bx, by + spec.pot.height * 0.92, bz]
  const leaves: Leaf[] = []
  const stems: Stem[] = []
  const count = 10
  for (let i = 0; i < count; i++) {
    // Fan toward the room (+x, +z), away from the corner walls.
    const azimuth = -0.25 + (i / (count - 1)) * 1.95 + (rand() - 0.5) * 0.25
    const out = 0.12 + rand() * 0.24
    const height = 0.28 + rand() * 0.55
    const tip: Vec3 = [soil[0] + Math.sin(azimuth) * out, soil[1] + height, soil[2] + Math.cos(azimuth) * out]
    stems.push({ a: soil, b: tip, radius: 0.006 })
    const outward = norm([Math.sin(azimuth), 0.35 + rand() * 0.4, Math.cos(azimuth)])
    const length = 0.26 + rand() * 0.14
    leaves.push({
      position: tip,
      direction: norm([outward[0], outward[1] - 0.35, outward[2]]),
      // Tilted out toward the room, so the leaves read from the desk rather than edge-on.
      facing: norm([outward[0] * 0.85, 0.75, outward[2] * 0.85]),
      length,
      width: length * 0.92,
      shape: LEAF_SHAPE.monstera,
      bend: -0.18 - rand() * 0.15,
      sway: 0.5 + (height / 0.83) * 0.5,
      phase: rand() * Math.PI * 2,
      rate: 0.7 + rand() * 0.5,
      tint: green(rand, 0),
    })
  }
  return { spec, leaves, stems }
}

/** Snake plant: stiff upright blades from the soil, a slight outward lean and twist. */
function snake(spec: PlantSpec, rand: Rand): Plant {
  const [bx, by, bz] = spec.base
  const top = by + spec.pot.height * 0.92
  const leaves: Leaf[] = []
  const count = 9
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.4
    const r = spec.pot.radius * (0.15 + rand() * 0.55)
    const lean = 0.06 + rand() * 0.16
    const direction = norm([Math.sin(angle) * lean, 1, Math.cos(angle) * lean])
    const twist = angle + Math.PI / 2 + (rand() - 0.5) * 1.2
    leaves.push({
      position: [bx + Math.sin(angle) * r, top - 0.01, bz + Math.cos(angle) * r],
      direction,
      facing: norm([Math.sin(twist), 0, Math.cos(twist)]),
      length: 0.42 + rand() * 0.34,
      width: 0.055 + rand() * 0.025,
      shape: LEAF_SHAPE.blade,
      bend: 0.05 + rand() * 0.1,
      sway: 0.18,
      phase: rand() * Math.PI * 2,
      rate: 0.6 + rand() * 0.4,
      tint: green(rand, 0.2),
    })
  }
  return { spec, leaves, stems: [] }
}

/** Pothos: a mound of heart leaves on the pot and vines trailing along the desk and over its edge. */
function pothos(spec: PlantSpec, rand: Rand): Plant {
  const [bx, by, bz] = spec.base
  const rim: Vec3 = [bx, by + spec.pot.height, bz]
  const leaves: Leaf[] = []
  const stems: Stem[] = []
  const leaf = (position: Vec3, direction: Vec3, size: number, sway: number) =>
    leaves.push({
      position,
      direction: norm([...direction]),
      facing: norm([direction[0] * 0.2 + (rand() - 0.5) * 0.4, 1, direction[2] * 0.2 + 0.35]),
      length: size,
      width: size * 0.82,
      shape: LEAF_SHAPE.pothos,
      bend: -0.1 - rand() * 0.1,
      sway,
      phase: rand() * Math.PI * 2,
      rate: 0.9 + rand() * 0.6,
      tint: green(rand, 0.4),
    })
  // The mound.
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2
    const r = spec.pot.radius * rand() * 0.8
    const lift = 0.01 + rand() * 0.06
    leaf([bx + Math.sin(angle) * r, rim[1] + lift, bz + Math.cos(angle) * r], [Math.sin(angle), 0.6 + rand() * 0.6, Math.cos(angle)], 0.045 + rand() * 0.025, 0.4)
  }
  // Vines: along the desk's back edge to the left, toward the front, and over the right edge, hanging down.
  const vines: Vec3[][] = [
    [rim, [bx - 0.08, by + 0.012, bz - 0.06], [bx - 0.2, by + 0.008, bz - 0.08], [bx - 0.3, by + 0.006, bz - 0.05]],
    [rim, [bx + 0.03, by + 0.01, bz + 0.1], [bx - 0.01, by + 0.006, bz + 0.2]],
    [rim, [bx + 0.075, by + 0.01, bz - 0.02], [0.86, by - 0.01, bz], [0.865, by - 0.14, bz + 0.03], [0.862, by - 0.27, bz + 0.01]],
  ]
  for (const vine of vines) {
    for (let k = 1; k < vine.length; k++) {
      const a = vine[k - 1]
      const b = vine[k]
      if (!a || !b) continue
      stems.push({ a, b, radius: 0.0022 })
      const steps = 3
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1)
        const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 0.004, a[2] + (b[2] - a[2]) * t]
        const side = s % 2 === 0 ? 1 : -1
        const hanging = b[1] < by - 0.02
        leaf(p, hanging ? [side * 0.5, -0.4, 0.6] : [side * 0.7, 0.45, 0.5 + rand() * 0.3], 0.035 + rand() * 0.02, hanging ? 1 : 0.6)
      }
    }
  }
  return { spec, leaves, stems }
}

export function generatePlant(spec: PlantSpec): Plant {
  const rand = random(spec.seed)
  switch (spec.kind) {
    case 'monstera':
      return monstera(spec, rand)
    case 'snake':
      return snake(spec, rand)
    case 'pothos':
      return pothos(spec, rand)
  }
}

/** World tip of a leaf (ignoring its curl). */
export function leafTip(leaf: Leaf): Vec3 {
  return along(leaf.position, leaf.direction, leaf.length)
}
