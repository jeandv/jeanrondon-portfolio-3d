import { BufferAttribute, BufferGeometry, ShaderMaterial, Uniform, Vector2, Vector3, Vector4 } from 'three'
import { HORIZON_Y, linearColor, NOISE_GLSL, type CitySpec } from './cityLayer'

/**
 * The Obelisco de Barquisimeto (the owner's hometown landmark) seen through
 * the window: a small real mesh between the near (r=18) and far (r=30)
 * skyline cylinders, so it parallaxes against both while orbiting and the
 * depth buffer layers it for free (far skyline behind, near blocks, mist,
 * rain and the glass in front). One mesh, one ShaderMaterial, one draw call:
 * the board-formed shaft, the clock, the tile band, the plaque, the stair and
 * the wing are all procedural in the fragment shader, lit at night by warm
 * uplights from the base.
 *
 * Proportions follow the reference photo (75 m, ~1:8 on the wide face):
 * fractions of the shaft height H, measured down from the top or up from the base.
 *
 * A shader sprite inside the city layers would be cheaper still, but it
 * could not parallax between the near and far rows (both live on their own
 * cylinders) and would need its own depth-sorting logic; the mesh is ~70
 * triangles and the window shaders already pay for the pixels behind it.
 */

export interface ObeliskSpec {
  /** Distance (m) from `anchor_city`: between the near (18) and far (30) skylines. */
  readonly radius: number
  /** Angle around the anchor's vertical axis (rad, 0 = straight out, + = right). */
  readonly s: number
  /** t (tan elevation from HORIZON_Y, like the city layers) of the base and the top. */
  readonly baseT: number
  readonly topT: number
  /** Wide face : height (the reference reads ~1:8). */
  readonly widthRatio: number
  /** Side face : wide face. */
  readonly depthRatio: number
  /** Extra turn (rad) of the front face away from the viewer, so the right side face shows (a 3/4 view). */
  readonly turn: number
}

export const OBELISK: ObeliskSpec = {
  radius: 22,
  s: 0.42,
  baseT: -0.075,
  topT: 0.078,
  widthRatio: 1 / 7.6,
  depthRatio: 0.78,
  turn: 0.42,
}

/** Features as fractions of the shaft height (from the reference photo). */
export const OBELISK_SHAPE = {
  /** Tile band (red / white squares) just under the flat top. */
  tiles: { top: 0.016, bottom: 0.04, count: 9 },
  /** Clock: centre below the top, radius as a share of the wide face. */
  clock: { center: 0.088, radius: 0.24 },
  /** Dark plaque on the front face (fractions of the width / height from the base). */
  plaque: { left: -0.19, right: 0.05, bottom: 0.215, top: 0.3 },
  /** Stair landing height and the ramp's run (wide faces) to the left. */
  stair: { landing: 0.14, run: 1.2, width: 0.42 },
  /** Flared wing on the right face: reach (wide faces) and height. */
  wing: { reach: 0.45, rise: 0.2 },
  /** Plaza radius (wide faces). */
  plaza: 1.9,
  /** Board-form joints across the wide face. */
  joints: 7,
} as const

export interface ObeliskSize {
  readonly height: number
  readonly width: number
  readonly depth: number
  /** World Y of the base. */
  readonly baseY: number
}

export function obeliskSize(spec: ObeliskSpec = OBELISK): ObeliskSize {
  const baseY = HORIZON_Y + spec.baseT * spec.radius
  const height = (spec.topT - spec.baseT) * spec.radius
  const width = height * spec.widthRatio
  return { height, width, depth: width * spec.depthRatio, baseY }
}

export interface ObeliskPose {
  /** World position of the base centre. */
  readonly position: Vector3
  /** Rotation about +Y (rad) of the local frame (front face = local +Z). */
  readonly yaw: number
}

/**
 * Where the obelisk stands around `city` (anchor_city), its front turned
 * toward `viewer` (the home camera) and then `turn` further left.
 */
export function obeliskPose(city: Vector3, viewer: Vector3, spec: ObeliskSpec = OBELISK): ObeliskPose {
  const { baseY } = obeliskSize(spec)
  const position = new Vector3(city.x + spec.radius * Math.sin(spec.s), baseY, city.z - spec.radius * Math.cos(spec.s))
  // Local +Z → (sin yaw, 0, cos yaw): face the viewer, then turn away to show the right side.
  const facing = Math.atan2(viewer.x - position.x, viewer.z - position.z)
  return { position, yaw: facing - spec.turn }
}

/** Angle (rad, around the anchor) where a ray from `viewer` to `point` crosses a cylinder of `radius` around `city`. */
export function angleOnCylinder(city: Vector3, viewer: Vector3, point: Vector3, radius: number): number {
  const px = viewer.x - city.x
  const pz = viewer.z - city.z
  let dx = point.x - viewer.x
  let dz = point.z - viewer.z
  const length = Math.hypot(dx, dz) || 1
  dx /= length
  dz /= length
  const b = px * dx + pz * dz
  const c = px * px + pz * pz - radius * radius
  const along = -b + Math.sqrt(Math.max(0, b * b - c))
  return Math.atan2(px + along * dx, -(pz + along * dz))
}

export interface Clearing {
  /** Centre angle (rad) on the layer. */
  readonly s: number
  /** Half width (rad) of the lowered stretch (it eases back to full height over the outer 40%). */
  readonly halfWidth: number
  /** Height factor of the buildings in the middle of it. */
  readonly scale: number
}

/** How much a layer lowers its blocks around the obelisk (Barquisimeto is mostly low-rise). */
export const CLEARING_SCALE = { near: 0.8, far: 0.6 } as const
/** Lowered stretch per side, in obelisk widths (as seen from the viewer). */
const CLEARING_WIDTHS = 3.2

/**
 * The stretch of a skyline layer behind / in front of the obelisk as seen
 * from `viewer`, where its blocks are lowered a little.
 */
export function clearingFor(layer: CitySpec, city: Vector3, viewer: Vector3, scale: number, spec: ObeliskSpec = OBELISK): Clearing {
  const { position } = obeliskPose(city, viewer, spec)
  const { width } = obeliskSize(spec)
  const toViewer = new Vector3(viewer.x - position.x, 0, viewer.z - position.z).normalize()
  const side = new Vector3(-toViewer.z, 0, toViewer.x).multiplyScalar(width * CLEARING_WIDTHS)
  const left = angleOnCylinder(city, viewer, position.clone().sub(side), layer.radius)
  const right = angleOnCylinder(city, viewer, position.clone().add(side), layer.radius)
  return { s: (left + right) / 2, halfWidth: Math.abs(right - left) / 2, scale }
}

/** Writes a clearing into a city layer material (`uClear`). */
export function applyClearing(material: ShaderMaterial, clearing: Clearing): void {
  const uniform: unknown = material.uniforms.uClear?.value
  if (uniform instanceof Vector3) uniform.set(clearing.s, clearing.halfWidth, clearing.scale)
}

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

/** Part ids (the `aPart` attribute). */
export const OBELISK_PART = { shaft: 0, base: 1, plaza: 2 } as const

type V3 = readonly [number, number, number]

class Builder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly parts: number[] = []

  /** Triangle (counter-clockwise from the side it faces). */
  tri(a: V3, b: V3, c: V3, part: number): void {
    const ab = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const ac = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    const n = ab.cross(ac).normalize()
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2])
      this.normals.push(n.x, n.y, n.z)
      this.parts.push(part)
    }
  }

  /** Quad a-b-c-d (counter-clockwise from the side it faces). */
  quad(a: V3, b: V3, c: V3, d: V3, part: number): void {
    this.tri(a, b, c, part)
    this.tri(a, c, d, part)
  }

  /** Box without its bottom face, from (x0, y0, z0) to (x1, y1, z1). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, part: number): void {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], part)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], part)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], part)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], part)
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], part)
  }
}

/**
 * Local frame: origin on the base centre, +Y up, the wide front face on +Z.
 * Shaft, the stair ramp rising from the left front to a landing, the flared
 * wing on the right, and a plaza disc (part ids in `aPart`).
 */
export function createObeliskGeometry(size: ObeliskSize): BufferGeometry {
  const { width: W, height: H, depth: D } = size
  const b = new Builder()
  const hw = W / 2
  const hd = D / 2
  b.box(-hw, 0, -hd, hw, H, hd, OBELISK_PART.shaft)

  // Stair: a ramp from the ground on the left up to a landing in front of the shaft.
  const { landing, run, width: stairWidth } = OBELISK_SHAPE.stair
  const top = landing * H
  const z0 = hd
  const z1 = hd + stairWidth * W
  const x0 = -hw - run * W
  const x1 = -hw * 0.2
  b.quad([x0, 0, z1], [x1, top, z1], [x1, top, z0], [x0, 0, z0], OBELISK_PART.base)
  // Its outer parapet (the curved white wall, flattened) and the landing block.
  const rail = 0.025 * H
  b.quad([x0, 0, z1], [x1, 0, z1], [x1, top + rail, z1], [x0, rail, z1], OBELISK_PART.base)
  b.box(x1, 0, z0, hw * 0.75, top, z1, OBELISK_PART.base)
  // Flared wing on the right: a thin fin leaning out from the right face.
  const { reach, rise } = OBELISK_SHAPE.wing
  const out = hw + reach * W
  const fin = hw + 0.05 * W
  const wingTop = rise * H
  b.quad([hw, 0, hd], [out, 0, hd * 0.2], [fin, wingTop, hd * 0.2], [hw, wingTop, hd], OBELISK_PART.base)
  b.quad([out, 0, -hd * 0.2], [hw, 0, -hd], [hw, wingTop, -hd], [fin, wingTop, -hd * 0.2], OBELISK_PART.base)
  b.quad([out, 0, hd * 0.2], [out, 0, -hd * 0.2], [fin, wingTop, -hd * 0.2], [fin, wingTop, hd * 0.2], OBELISK_PART.base)

  // Plaza: a small dark disc with the floodlights' pools (grounds the base where a gap shows it).
  const segments = 16
  const radius = OBELISK_SHAPE.plaza * W
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    b.tri([0, 0.002, 0], [Math.sin(a0) * radius, 0.002, Math.cos(a0) * radius], [Math.sin(a1) * radius, 0.002, Math.cos(a1) * radius], OBELISK_PART.plaza)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3))
  geometry.setAttribute('aPart', new BufferAttribute(new Float32Array(b.parts), 1))
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/* ------------------------------------------------------------------ */
/* Material                                                             */
/* ------------------------------------------------------------------ */

/** Night palette (sRGB). */
export const OBELISK_COLORS = {
  concrete: '#d9d4ca',
  uplight: '#ffecd6',
  sky: '#1b2236',
  clockFace: '#ffdca0',
  clockRing: '#e8a646',
  hands: '#1a1612',
  tileRed: '#d22a4c',
  tileWhite: '#f2ece2',
  plaque: '#14110e',
  hazeLow: '#5a3a22',
  hazeHigh: '#14171f',
} as const

/**
 * Light levels (linear): the floodlit concrete stays well under the bloom
 * threshold (0.88), the clock face crosses it a little, the tiles glow faintly.
 */
export const OBELISK_LIGHT = {
  uplight: 0.6,
  ambient: 0.06,
  clock: 1.35,
  ring: 0.95,
  tiles: 0.32,
  haze: 0.12,
} as const

const VERTEX = /* glsl */ `
attribute float aPart;
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying float vPart;
void main() {
  vLocal = position;
  vNormalLocal = normal;
  vPart = aPart;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uSize;
uniform vec2 uHands;
uniform vec3 uConcrete;
uniform vec3 uUplight;
uniform vec3 uSky;
uniform vec3 uClockFace;
uniform vec3 uClockRing;
uniform vec3 uHandsColor;
uniform vec3 uTileRed;
uniform vec3 uTileWhite;
uniform vec3 uPlaque;
uniform vec3 uHazeLow;
uniform vec3 uHazeHigh;
uniform vec4 uLevels;   // uplight, ambient, clock, ring
uniform vec2 uLevels2;  // tiles, haze
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying float vPart;

${NOISE_GLSL}

const float PI = 3.14159265;

// Anti-aliased box [a, b] with half-pixel width w.
float band(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}

// Distance from p to the segment from the origin along dir, length len.
float segment(vec2 p, vec2 dir, float len) {
  float k = clamp(dot(p, dir), 0.0, len);
  return length(p - dir * k);
}

// The clock on the front face: gold beaded ring, warm face, dark hands (clockwise from 12).
vec3 clockFace(vec2 p, float r, float aa, vec3 wall, out float cover) {
  float d = length(p);
  cover = 1.0 - smoothstep(r - aa, r + aa, d);
  if (cover <= 0.0) return wall;
  float angle = atan(p.x, p.y);
  float beads = 0.5 + 0.5 * cos(angle * 16.0);
  float ringOuter = r * (0.9 + 0.1 * beads);
  float ring = band(d, r * 0.74, ringOuter, aa);
  vec3 col = uClockFace * uLevels.z;
  col = mix(col, uClockRing * uLevels.w, ring);
  // Hands.
  vec2 hour = vec2(sin(uHands.x), cos(uHands.x));
  vec2 minute = vec2(sin(uHands.y), cos(uHands.y));
  float hands = max(
    1.0 - smoothstep(r * 0.05, r * 0.05 + aa, segment(p, hour, r * 0.42)),
    1.0 - smoothstep(r * 0.035, r * 0.035 + aa, segment(p, minute, r * 0.66))
  );
  col = mix(col, uHandsColor, hands * (1.0 - ring));
  return mix(wall, col, cover);
}

void main() {
  float W = uSize.x;
  float H = uSize.y;
  float D = uSize.z;
  vec3 n = normalize(vNormalLocal);
  float h = clamp(vLocal.y / H, 0.0, 1.0);
  vec3 col;

  if (vPart > 1.5) {
    // Plaza: dark paving with the floodlights' warm pools around the base.
    float d = length(vLocal.xz) / W;
    float pool = exp(-d * d * 1.2) * 0.35;
    col = uConcrete * 0.03 * (0.6 + 0.4 * vnoise(vLocal.xz * 9.0)) + uUplight * pool * uLevels.x * 0.2;
  } else {
    bool front = n.z > 0.5;
    bool side = abs(n.x) > 0.5;
    bool top = n.y > 0.5;
    // Across-face coordinate (m) and its pixel width.
    float u = front || n.z < -0.5 ? vLocal.x : vLocal.z;
    float faceWidth = front || n.z < -0.5 ? W : D;
    float aaU = max(fwidth(u), 1e-5);
    float aaY = max(fwidth(vLocal.y), 1e-5);

    // Warm-white floodlights from the base, fading up the shaft; the front catches most.
    float facing = front ? 1.0 : (side ? (n.x > 0.0 ? 0.62 : 0.42) : 0.3);
    float beam = 0.78 + 0.22 * cos(clamp(u / faceWidth, -0.5, 0.5) * PI * 1.6);
    float rise = exp(-h * 2.4) * 0.7 + 0.3;
    float up = uLevels.x * facing * beam * rise;
    if (top) up = uLevels.x * 0.05;
    // The base sits low among the blocks: dimmer than the floodlit shaft.
    if (vPart > 0.5) up = uLevels.x * (n.y > 0.3 ? 0.28 : 0.3) * (0.8 + 0.2 * facing);

    // Board-formed concrete: vertical joints, faint pour lines, a little mottling.
    float joints = 0.0;
    if (vPart < 0.5 && !top) {
      float cells = float(${OBELISK_SHAPE.joints});
      float j = fract((u / faceWidth + 0.5) * cells);
      float wJ = max(aaU / faceWidth * cells, 0.02);
      joints = 1.0 - smoothstep(0.0, wJ * 1.5, min(j, 1.0 - j));
      float pour = fract(vLocal.y / (H / 18.0));
      joints = max(joints * 0.28, (1.0 - smoothstep(0.0, max(aaY / (H / 18.0), 0.03), min(pour, 1.0 - pour))) * 0.08);
    }
    float mottle = 0.9 + 0.1 * vnoise(vec2(u * 40.0, vLocal.y * 12.0));
    vec3 albedo = uConcrete * mottle * (1.0 - joints);
    // The ramp's steps sit in the parapet's shadow; the white walls catch the floodlights.
    if (vPart > 0.5 && n.y > 0.3) albedo *= 0.35 + 0.15 * step(0.5, fract(vLocal.y / (H * 0.012)));
    else if (vPart > 0.5) albedo *= 0.75;
    col = albedo * (uUplight * up + uSky * uLevels.y);

    if (vPart < 0.5 && !top) {
      float fromTop = (H - vLocal.y) / H;
      // Tile band: red and white squares (front and sides), faintly lit.
      float inBand = band(fromTop, ${OBELISK_SHAPE.tiles.top.toFixed(3)}, ${OBELISK_SHAPE.tiles.bottom.toFixed(3)}, aaY / H);
      if (inBand > 0.0) {
        float k = (u / faceWidth + 0.5) * float(${OBELISK_SHAPE.tiles.count});
        float tile = mod(floor(k), 2.0);
        float grout = band(fract(k), 0.08, 0.92, max(aaU / faceWidth * float(${OBELISK_SHAPE.tiles.count}), 0.02));
        vec3 tileCol = mix(uTileRed, uTileWhite, tile) * (uLevels2.x + up * 0.6);
        col = mix(col, tileCol, inBand * grout);
      }
      if (front) {
        // Plaque (a dark rectangle, the door to the lookout).
        float plaque = band(vLocal.x / W, ${OBELISK_SHAPE.plaque.left.toFixed(3)}, ${OBELISK_SHAPE.plaque.right.toFixed(3)}, aaU / W)
          * band(h, ${OBELISK_SHAPE.plaque.bottom.toFixed(3)}, ${OBELISK_SHAPE.plaque.top.toFixed(3)}, aaY / H);
        col = mix(col, uPlaque * (0.4 + up), plaque);
        // Clock.
        vec2 p = vec2(vLocal.x, vLocal.y - H * (1.0 - ${OBELISK_SHAPE.clock.center.toFixed(3)}));
        float cover;
        col = clockFace(p, W * ${OBELISK_SHAPE.clock.radius.toFixed(3)}, max(aaU, aaY), col, cover);
      }
    }
  }

  // The same night air as the skyline at this distance: sodium low, cold up high.
  vec3 haze = mix(uHazeLow, uHazeHigh, smoothstep(0.0, 0.6, h));
  col = mix(col, haze, uLevels2.y * (0.6 + 0.4 * (1.0 - h)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export interface ObeliskUniforms {
  /** Hour and minute hand angles (rad, clockwise from 12). */
  readonly uHands: Uniform<Vector2>
}

/** Opaque: drawn before the sky (early-z), behind the near skyline, mist and rain. */
export function createObeliskMaterial(size: ObeliskSize): ShaderMaterial & { uniforms: ObeliskUniforms } {
  const c = OBELISK_COLORS
  const l = OBELISK_LIGHT
  const material = new ShaderMaterial({
    name: 'city_obelisk',
    uniforms: {
      uSize: new Uniform(new Vector3(size.width, size.height, size.depth)),
      uHands: new Uniform(new Vector2(0, 0)),
      uConcrete: new Uniform(linearColor(c.concrete)),
      uUplight: new Uniform(linearColor(c.uplight)),
      uSky: new Uniform(linearColor(c.sky)),
      uClockFace: new Uniform(linearColor(c.clockFace)),
      uClockRing: new Uniform(linearColor(c.clockRing)),
      uHandsColor: new Uniform(linearColor(c.hands)),
      uTileRed: new Uniform(linearColor(c.tileRed)),
      uTileWhite: new Uniform(linearColor(c.tileWhite)),
      uPlaque: new Uniform(linearColor(c.plaque)),
      uHazeLow: new Uniform(linearColor(c.hazeLow)),
      uHazeHigh: new Uniform(linearColor(c.hazeHigh)),
      uLevels: new Uniform(new Vector4(l.uplight, l.ambient, l.clock, l.ring)),
      uLevels2: new Uniform(new Vector2(l.tiles, l.haze)),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
  return material as ShaderMaterial & { uniforms: ObeliskUniforms }
}
