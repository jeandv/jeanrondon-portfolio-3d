import type { PaperSize, Poster, WallSlot } from '../../../content/posters'

/**
 * Where the posters hang (pure, three-free) and how their art packs into one
 * atlas. Slots are spots on the greybox walls (scripts/make-greybox.mjs: back
 * wall face z = −0.40, side walls x = ±2.6, the window x −1.4…1.0 /
 * y 0.95…2.3 with its frame and sill, the clock at (1.93, 1.19)); a Blender
 * `poster_<id>` plane overrides a slot.
 *
 * What the cameras see (home is mostly glass, see README): at 16:9 and wider
 * the home view shows the wall strip right of the window (two posters) and
 * the strip under the sill (a small banner); #about sees under the clock; the
 * side walls and the wall left of the window come in while orbiting.
 */

export type Wall = 'back' | 'left' | 'right'
export type Vec3 = readonly [number, number, number]

export interface WallPlane {
  /** A point on the wall's room-side face. */
  readonly origin: Vec3
  /** Into the room. */
  readonly normal: Vec3
  /** Horizontal axis as seen facing the wall (left → right). */
  readonly right: Vec3
}

/** Greybox wall faces. */
export const WALLS: Readonly<Record<Wall, WallPlane>> = {
  back: { origin: [0, 0, -0.4], normal: [0, 0, 1], right: [1, 0, 0] },
  left: { origin: [-2.6, 0, 0], normal: [1, 0, 0], right: [0, 0, -1] },
  right: { origin: [2.6, 0, 0], normal: [-1, 0, 0], right: [0, 0, 1] },
}

export interface SlotDef {
  readonly wall: Wall
  /** World x (back wall) or z (side walls) of the poster's centre. */
  readonly at: number
  /** World y of the centre. */
  readonly y: number
}

export const WALL_SLOTS: Readonly<Record<WallSlot, SlotDef>> = {
  // Left of the window, above the monstera.
  'back-left': { wall: 'back', at: -2.0, y: 1.52 },
  // Right of the window: the strip the home view sees at 16:9 and wider (the PC sits in front, lower).
  'back-right-upper': { wall: 'back', at: 1.215, y: 1.44 },
  'back-right-lower': { wall: 'back', at: 1.215, y: 0.93 },
  // The wall strip between the desk top and the sill, left of the lamp (home, 16:9 and wider).
  'under-sill': { wall: 'back', at: -0.8, y: 0.84 },
  // Under the wall clock: the bare wall the #about view sees.
  'under-clock': { wall: 'back', at: 1.93, y: 0.8 },
  'left-wall': { wall: 'left', at: 0.55, y: 1.5 },
  'right-wall-near': { wall: 'right', at: 0.3, y: 1.5 },
  'right-wall-far': { wall: 'right', at: 0.9, y: 1.48 },
}

/** Paper stands this far (m) off the wall at its edges (the curl adds to it). */
export const WALL_GAP = 0.004

export interface PosterQuad {
  /** Centre on the wall (WALL_GAP in front of it). */
  readonly center: Vec3
  readonly right: Vec3
  readonly up: Vec3
  readonly normal: Vec3
  readonly width: number
  readonly height: number
  readonly wall: Wall
}

export function posterQuad(slot: WallSlot, size: PaperSize): PosterQuad {
  const def = WALL_SLOTS[slot]
  const plane = WALLS[def.wall]
  const [ox, , oz] = plane.origin
  const [nx, , nz] = plane.normal
  const center: Vec3 =
    def.wall === 'back' ? [def.at, def.y, oz + nz * WALL_GAP] : [ox + nx * WALL_GAP, def.y, def.at]
  return { center, right: plane.right, up: [0, 1, 0], normal: plane.normal, width: size.width, height: size.height, wall: def.wall }
}

export interface WallRect {
  readonly wall: Wall
  /** Along the wall's own horizontal coordinate (x for the back wall, z for the sides). */
  readonly a0: number
  readonly a1: number
  readonly y0: number
  readonly y1: number
}

/** The poster's footprint on its wall. */
export function wallRect(slot: WallSlot, size: PaperSize): WallRect {
  const { wall, at, y } = WALL_SLOTS[slot]
  return { wall, a0: at - size.width / 2, a1: at + size.width / 2, y0: y - size.height / 2, y1: y + size.height / 2 }
}

export function rectsOverlap(a: WallRect, b: WallRect, margin = 0): boolean {
  return a.wall === b.wall && a.a0 < b.a1 + margin && b.a0 < a.a1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin
}

/* ------------------------------------------------------------------ */
/* Atlas                                                                */
/* ------------------------------------------------------------------ */

export interface AtlasSpec {
  readonly width: number
  readonly height: number
  /** Transparent gutter (px) around each poster so mips never bleed. */
  readonly pad: number
}

/** One 2048² atlas on desktop (~17 MB with mips), half that on phones. */
export const POSTER_ATLAS: AtlasSpec = { width: 2048, height: 2048, pad: 8 }
export const POSTER_ATLAS_PHONE: AtlasSpec = { width: 1024, height: 1024, pad: 4 }

export interface AtlasRect {
  /** Canvas px. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface AtlasLayout {
  /** Pixels per metre of paper. */
  readonly density: number
  readonly rects: readonly AtlasRect[]
  /** Shelf rows used (top to bottom). */
  readonly rows: number
}

/** Shelf packing at one density (input order kept in the result); null if it does not fit. */
export function packAt(sizes: readonly PaperSize[], atlas: AtlasSpec, density: number): Omit<AtlasLayout, 'density'> | null {
  const order = sizes.map((size, index) => ({ index, w: Math.ceil(size.width * density), h: Math.ceil(size.height * density) }))
  order.sort((a, b) => b.h - a.h || b.w - a.w || a.index - b.index)
  const rects: AtlasRect[] = new Array<AtlasRect>(sizes.length)
  let x = atlas.pad
  let y = atlas.pad
  let rowHeight = 0
  let rows = sizes.length > 0 ? 1 : 0
  for (const item of order) {
    if (item.w + atlas.pad * 2 > atlas.width) return null
    if (x + item.w + atlas.pad > atlas.width) {
      x = atlas.pad
      y += rowHeight + atlas.pad * 2
      rowHeight = 0
      rows++
    }
    if (y + item.h + atlas.pad > atlas.height) return null
    rects[item.index] = { x, y, w: item.w, h: item.h }
    x += item.w + atlas.pad * 2
    rowHeight = Math.max(rowHeight, item.h)
  }
  return { rects, rows }
}

/** The sharpest density (px/m, in steps of 25) at which every poster fits the atlas. */
export function packAtlas(sizes: readonly PaperSize[], atlas: AtlasSpec = POSTER_ATLAS, max = 1600, min = 200): AtlasLayout {
  for (let density = max; density >= min; density -= 25) {
    const packed = packAt(sizes, atlas, density)
    if (packed) return { density, ...packed }
  }
  throw new Error('[posters] the posters do not fit the atlas')
}

export interface UvRect {
  readonly u0: number
  readonly u1: number
  /** v grows downward (canvas texture with flipY = false). */
  readonly v0: number
  readonly v1: number
}

export function rectUv(rect: AtlasRect, atlas: AtlasSpec): UvRect {
  return { u0: rect.x / atlas.width, u1: (rect.x + rect.w) / atlas.width, v0: rect.y / atlas.height, v1: (rect.y + rect.h) / atlas.height }
}

/** Posters laid out for the atlas, in content order. */
export function posterAtlas(posters: readonly Poster[], atlas: AtlasSpec = POSTER_ATLAS): AtlasLayout {
  return packAtlas(
    posters.map((poster) => poster.size),
    atlas,
  )
}
