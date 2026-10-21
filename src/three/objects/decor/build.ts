import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Uniform,
  Vector3,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Bulb, LedSpec, Vec3 } from './lights'
import { LEAF_SHAPES, type Leaf, type Plant } from './plants'

/**
 * Three objects for the decor (pure data from plants.ts / lights.ts):
 *   static  pots, soil, stalks, vines, the fairy-light wire, the LED housing:
 *           one merged geometry with vertex colours, one draw call
 *   leaves  every leaf of every plant: one InstancedMesh (leaf atlas, alpha
 *           test, a slight wind sway in the vertex shader), one draw call
 *   bulbs   the fairy bulbs: one InstancedMesh, colours set per frame
 *   led     the strip's face + its spill on the wall and the desk: one
 *           additive mesh
 */

const UP = new Vector3(0, 1, 0)

function painted(geometry: BufferGeometry, hex: string): BufferGeometry {
  const color = new Color(hex)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3)
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry.index ? geometry.toNonIndexed() : geometry
}

/** A thin tube from a to b. */
function tube(a: Vec3, b: Vec3, radius: number, hex: string, segments = 5): BufferGeometry {
  const start = new Vector3(...a)
  const end = new Vector3(...b)
  const length = start.distanceTo(end)
  const geometry = new CylinderGeometry(radius, radius, Math.max(length, 1e-4), segments, 1, true)
  const direction = end.clone().sub(start).normalize()
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, direction))
  geometry.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
  return painted(geometry, hex)
}

export const DECOR_COLORS = {
  soil: '#2b1d14',
  stalk: '#3f6a2e',
  vine: '#4c7a36',
  wire: '#1d2016',
  housing: '#1c1d22',
} as const

export interface StaticDecorInput {
  readonly plants: readonly Plant[]
  readonly wire: readonly Vec3[]
  readonly led: LedSpec | null
}

/** Pots, soil, stalks, vines, the fairy wire and the LED housing in one geometry. */
export function createStaticDecorGeometry({ plants, wire, led }: StaticDecorInput): BufferGeometry | null {
  const parts: BufferGeometry[] = []
  for (const { spec, stems } of plants) {
    const [x, y, z] = spec.base
    const { radius, height, color } = spec.pot
    const pot = new CylinderGeometry(radius, radius * 0.78, height, 20, 1, false)
    pot.translate(x, y + height / 2, z)
    parts.push(painted(pot, color))
    const rim = new CylinderGeometry(radius * 1.06, radius * 1.06, height * 0.12, 20, 1, false)
    rim.translate(x, y + height * 0.94, z)
    parts.push(painted(rim, color))
    const soil = new CircleGeometry(radius * 0.96, 16)
    soil.rotateX(-Math.PI / 2)
    soil.translate(x, y + height * 0.92, z)
    parts.push(painted(soil, DECOR_COLORS.soil))
    for (const stem of stems) parts.push(tube(stem.a, stem.b, stem.radius, spec.kind === 'pothos' ? DECOR_COLORS.vine : DECOR_COLORS.stalk))
  }
  for (let i = 1; i < wire.length; i++) {
    const a = wire[i - 1]
    const b = wire[i]
    if (a && b) parts.push(tube(a, b, 0.0011, DECOR_COLORS.wire, 4))
  }
  if (led) {
    const housing = new BoxGeometry(led.to - led.from, led.height * 1.3, 0.006)
    housing.translate((led.from + led.to) / 2, led.y, led.z - 0.002)
    parts.push(painted(housing, DECOR_COLORS.housing))
  }
  if (parts.length === 0) return null
  const merged = mergeGeometries(parts.map((part) => {
    part.deleteAttribute('uv')
    return part
  }))
  for (const part of parts) part.dispose()
  return merged
}

export function createStaticDecorMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ name: 'M_decor', vertexColors: true, roughness: 0.82, metalness: 0 })
}

/* ------------------------------------------------------------------ */
/* Leaves                                                               */
/* ------------------------------------------------------------------ */

export interface SwayUniforms {
  readonly uTime: Uniform<number>
  /** 0 = still (reduced motion, capture), 1 = full sway. */
  readonly uSway: Uniform<number>
}

/** Leaf transform: local +Y along the leaf, +X across it (scaled by width), +Z its face. */
export function leafMatrix(leaf: Leaf, out = new Matrix4()): Matrix4 {
  const y = new Vector3(...leaf.direction)
  const x = new Vector3().crossVectors(y, new Vector3(...leaf.facing))
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x.normalize()
  const z = new Vector3().crossVectors(x, y).normalize()
  out.makeBasis(x.multiplyScalar(leaf.width), y.multiplyScalar(leaf.length), z.multiplyScalar(leaf.width))
  out.setPosition(...leaf.position)
  return out
}

const LEAF_VERTEX_HEAD = /* glsl */ `
attribute vec4 aLeaf;
uniform float uTime;
uniform float uSway;
`

// Curl toward the face along the leaf, and a slight sway growing toward the tip.
const LEAF_VERTEX_BEGIN = /* glsl */ `
#include <begin_vertex>
float leafT = uv.y * uv.y;
transformed.z += aLeaf.y * leafT;
float sway = uSway * aLeaf.z * leafT * sin(uTime * (0.8 + aLeaf.w * 0.15) + aLeaf.w);
transformed.x += sway * 0.12;
transformed.z += sway * 0.08;
`

export function createLeafMesh(leaves: readonly Leaf[], atlas: Texture, sway: SwayUniforms): InstancedMesh {
  const geometry = new PlaneGeometry(1, 1, 1, 6)
  geometry.translate(0, 0.5, 0)
  const data = new Float32Array(leaves.length * 4)
  leaves.forEach((leaf, i) => data.set([leaf.shape, leaf.bend, leaf.sway, leaf.phase + leaf.rate * 3], i * 4))
  geometry.setAttribute('aLeaf', new InstancedBufferAttribute(data, 4))
  const material = new MeshStandardMaterial({ name: 'M_leaves', map: atlas, alphaTest: 0.5, side: DoubleSide, roughness: 0.62, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sway.uTime
    shader.uniforms.uSway = sway.uSway
    shader.vertexShader = LEAF_VERTEX_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', LEAF_VERTEX_BEGIN)
      // Each leaf samples its own column of the atlas.
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aLeaf.x) / ${LEAF_SHAPES.toFixed(1)};\n#endif`)
  }
  material.customProgramCacheKey = () => 'decor-leaves-v1'
  const mesh = new InstancedMesh(geometry, material, leaves.length)
  mesh.name = 'decor_leaves'
  const matrix = new Matrix4()
  const color = new Color()
  leaves.forEach((leaf, i) => {
    mesh.setMatrixAt(i, leafMatrix(leaf, matrix))
    mesh.setColorAt(i, color.setRGB(...leaf.tint))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

/* ------------------------------------------------------------------ */
/* Fairy bulbs                                                          */
/* ------------------------------------------------------------------ */

export function createBulbMesh(bulbs: readonly Bulb[], radius: number): InstancedMesh {
  const geometry = new IcosahedronGeometry(radius, 1)
  const material = new MeshBasicMaterial({ name: 'M_fairy_bulbs', toneMapped: false })
  const mesh = new InstancedMesh(geometry, material, bulbs.length)
  mesh.name = 'fairy_bulbs'
  const matrix = new Matrix4()
  const black = new Color(0, 0, 0)
  bulbs.forEach((bulb, i) => {
    mesh.setMatrixAt(i, matrix.makeTranslation(...bulb.position))
    mesh.setColorAt(i, black)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

/* ------------------------------------------------------------------ */
/* LED strip glow                                                       */
/* ------------------------------------------------------------------ */

const LED_VERTEX = /* glsl */ `
attribute vec3 aGlow;
varying vec3 vGlow;
void main() {
  vGlow = aGlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// aGlow: x = 1 on the strip's face, y = distance from the strip (0 … 1), z = 0 … 1 along it.
const LED_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uCore;
uniform float uSpill;
varying vec3 vGlow;
void main() {
  float ends = smoothstep(0.0, 0.06, vGlow.z) * smoothstep(0.0, 0.06, 1.0 - vGlow.z);
  float fall = exp(-vGlow.y * 3.2) * (1.0 - smoothstep(0.75, 1.0, vGlow.y));
  float level = mix(uSpill * fall, uCore, vGlow.x) * ends;
  gl_FragColor = vec4(uColor * level, 1.0);
}
`

export interface LedUniforms {
  readonly uColor: Uniform<Color>
  readonly uCore: Uniform<number>
  readonly uSpill: Uniform<number>
}

function quad(positions: number[], glow: number[], corners: readonly Vec3[], glows: readonly Vec3[]): void {
  const order = [0, 1, 2, 0, 2, 3]
  for (const i of order) {
    const p = corners[i]
    const g = glows[i]
    if (!p || !g) continue
    positions.push(...p)
    glow.push(...g)
  }
}

/** The strip's face plus its spill up the wall and onto the desk (additive, no depth write). */
export function createLedMesh(led: LedSpec): { mesh: Mesh; uniforms: LedUniforms } {
  const positions: number[] = []
  const glow: number[] = []
  const { from, to, y, z, height } = led
  // Face of the strip (counter-clockwise toward +z).
  quad(
    positions,
    glow,
    [
      [from, y - height / 2, z + 0.0012],
      [to, y - height / 2, z + 0.0012],
      [to, y + height / 2, z + 0.0012],
      [from, y + height / 2, z + 0.0012],
    ],
    [
      [1, 0, 0],
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
    ],
  )
  // Wall spill, from the strip up to the sill.
  quad(
    positions,
    glow,
    [
      [from, y, led.wallZ],
      [to, y, led.wallZ],
      [to, led.wallTop, led.wallZ],
      [from, led.wallTop, led.wallZ],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  )
  // Desk spill, from the back edge forward (facing up).
  quad(
    positions,
    glow,
    [
      [from, led.deskY, led.deskFrom],
      [from, led.deskY, led.deskTo],
      [to, led.deskY, led.deskTo],
      [to, led.deskY, led.deskFrom],
    ],
    [
      [0, 0.1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0.1, 1],
    ],
  )
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('aGlow', new BufferAttribute(new Float32Array(glow), 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const uniforms: LedUniforms = { uColor: new Uniform(new Color(0, 0, 0)), uCore: new Uniform(0), uSpill: new Uniform(0) }
  const material = new ShaderMaterial({
    name: 'M_led_strip',
    uniforms: { ...uniforms },
    vertexShader: LED_VERTEX,
    fragmentShader: LED_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'led_strip_glow'
  return { mesh, uniforms }
}
