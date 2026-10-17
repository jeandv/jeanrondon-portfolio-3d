/**
 * Greybox room generator (stand-in for the Blender export until M3).
 *
 * Writes src/assets/models/room.glb following the Blender ↔ code naming
 * contract from docs/PLAN.md §6: snake_case node names, custom props as glTF
 * `extras` (three.js exposes them as `userData`), screens with UV0 0..1.
 *
 * Conventions: meters, +Y up, the camera looks toward −Z (desk against the
 * back wall at z ≈ −0.45). UVs follow glTF: (0,0) is the top-left of a face.
 */
import { mkdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_FILE = resolve(ROOT, 'src/assets/models/room.glb')

// Keep in sync with FRAMES.work in src/three/camera/frames.ts (used to aim
// anchor_notepad_up at the work camera).
const WORK_FRAME = { target: [0.2, 0.92, 0.02], dir: [-0.06, 0.42, 1], distance: 1.3 }

/* ------------------------------------------------------------------ */
/* Vector / quaternion helpers ([x, y, z] and [x, y, z, w] arrays)     */
/* ------------------------------------------------------------------ */

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a) => Math.hypot(a[0], a[1], a[2])
const normalize = (a) => scale(a, 1 / (length(a) || 1))
const round = (a, digits = 3) => a.map((v) => Number(v.toFixed(digits)))

const QUAT_IDENTITY = [0, 0, 0, 1]

/** Hamilton product a·b (applies b first, then a). */
function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function quatAxisAngle(axis, angle) {
  const [x, y, z] = normalize(axis)
  const s = Math.sin(angle / 2)
  return [x * s, y * s, z * s, Math.cos(angle / 2)]
}

const quatX = (angle) => quatAxisAngle([1, 0, 0], angle)
const quatY = (angle) => quatAxisAngle([0, 1, 0], angle)

/** Rotates vector v by unit quaternion q. */
function rotate(q, v) {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
function quatFromUnitVectors(from, to) {
  const r = dot(from, to) + 1
  let q
  if (r < 1e-6) {
    q = Math.abs(from[0]) > Math.abs(from[2]) ? [-from[1], from[0], 0, 0] : [0, -from[2], from[1], 0]
  } else {
    const c = cross(from, to)
    q = [c[0], c[1], c[2], r]
  }
  const l = Math.hypot(...q)
  return q.map((v) => v / l)
}

/** Quaternion from an orthonormal basis (the basis vectors are the matrix columns). */
function quatFromBasis(x, y, z) {
  const [m00, m10, m20] = x
  const [m01, m11, m21] = y
  const [m02, m12, m22] = z
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
}

/** Rotation whose local +Z points along `forward`, keeping local +Y close to world up. */
function quatFacing(forward, up = [0, 1, 0]) {
  const z = normalize(forward)
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  return quatFromBasis(x, y, z)
}

/** sRGB hex → linear RGB (glTF factors are linear). */
function hexToLinear(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
}

/* ------------------------------------------------------------------ */
/* Geometry builder                                                    */
/* ------------------------------------------------------------------ */

// [normal, u axis, v axis] with u × v = normal so quads wind CCW from outside.
const BOX_FACES = [
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
]

// Corner order: bottom-left, bottom-right, top-right, top-left (glTF UVs, v down).
const QUAD_UVS = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
]

class MeshBuilder {
  positions = []
  normals = []
  uvs = []
  indices = []

  get triangleCount() {
    return this.indices.length / 3
  }

  vertex(position, normal, uv) {
    this.positions.push(...position)
    this.normals.push(...normal)
    this.uvs.push(...uv)
    return this.positions.length / 3 - 1
  }

  quad(corners, normal) {
    const base = this.positions.length / 3
    corners.forEach((corner, i) => {
      this.positions.push(...corner)
      this.normals.push(...normal)
      this.uvs.push(...QUAD_UVS[i])
    })
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    return this
  }

  /** Axis-aligned box (in its own frame) rotated by `rotation` and moved to `center`. */
  box(size, { center = [0, 0, 0], rotation = QUAT_IDENTITY } = {}) {
    const half = scale(size, 0.5)
    for (const [n, u, v] of BOX_FACES) {
      const hn = Math.abs(dot(n, half))
      const hu = Math.abs(dot(u, half))
      const hv = Math.abs(dot(v, half))
      const faceCenter = scale(n, hn)
      const corner = (su, sv) =>
        add(center, rotate(rotation, add(faceCenter, add(scale(u, hu * su), scale(v, hv * sv)))))
      this.quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], rotate(rotation, n))
    }
    return this
  }

  /** Single-sided plane facing local +Z, UV0 0..1 with (0,0) at its top-left. */
  plane(width, height, { center = [0, 0, 0], rotation = QUAT_IDENTITY } = {}) {
    const corner = (su, sv) => add(center, rotate(rotation, [(width / 2) * su, (height / 2) * sv, 0]))
    return this.quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], rotate(rotation, [0, 0, 1]))
  }

  /** Square-section bar between two points. */
  beam(a, b, thickness) {
    const d = sub(b, a)
    return this.box([thickness, length(d), thickness], {
      center: scale(add(a, b), 0.5),
      rotation: quatFromUnitVectors([0, 1, 0], normalize(d)),
    })
  }

  /**
   * Smooth cylinder wall along local +Y between y0 and y1 (θ = 0 faces +Z).
   * `inward` flips it into an inner wall (normals toward the axis).
   */
  wall(radius, y0, y1, { segments = 24, inward = false, center = [0, 0, 0], rotation = QUAT_IDENTITY } = {}) {
    const at = (theta, y) => add(center, rotate(rotation, [radius * Math.sin(theta), y, radius * Math.cos(theta)]))
    const normalAt = (theta) => rotate(rotation, scale([Math.sin(theta), 0, Math.cos(theta)], inward ? -1 : 1))
    const base = this.positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2
      const n = normalAt(theta)
      this.vertex(at(theta, y0), n, [i / segments, 1])
      this.vertex(at(theta, y1), n, [i / segments, 0])
    }
    for (let i = 0; i < segments; i++) {
      const [b0, t0, b1, t1] = [base + i * 2, base + i * 2 + 1, base + i * 2 + 2, base + i * 2 + 3]
      if (inward) this.indices.push(b0, t1, b1, b0, t0, t1)
      else this.indices.push(b0, b1, t1, b0, t1, t0)
    }
    return this
  }

  /** Flat disc (or ring when `inner` > 0) at height y facing local +Y (`down`: −Y); planar UVs. */
  disc(radius, y, { inner = 0, down = false, segments = 24, center = [0, 0, 0], rotation = QUAT_IDENTITY } = {}) {
    const n = rotate(rotation, [0, down ? -1 : 1, 0])
    const point = (r, theta) => [r * Math.sin(theta), y, r * Math.cos(theta)]
    const uvOf = ([x, , z]) => [0.5 + x / (2 * radius), 0.5 - z / (2 * radius)]
    const put = (local) => this.vertex(add(center, rotate(rotation, local)), n, uvOf(local))
    const tri = (a, b, c) => (down ? this.indices.push(a, c, b) : this.indices.push(a, b, c))
    const middle = inner > 0 ? -1 : put([0, y, 0])
    const ring = (r) => Array.from({ length: segments }, (_, i) => put(point(r, (i / segments) * Math.PI * 2)))
    const outer = ring(radius)
    const hole = inner > 0 ? ring(inner) : []
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      if (inner > 0) {
        tri(hole[i], outer[i], outer[j])
        tri(hole[i], outer[j], hole[j])
      } else {
        tri(middle, outer[i], outer[j])
      }
    }
    return this
  }

  /** Closed cylinder along local +Y (caps on both ends). */
  cylinder(radius, height, options = {}) {
    const { center = [0, 0, 0], rotation = QUAT_IDENTITY, segments = 24 } = options
    const shared = { center, rotation, segments }
    return this.wall(radius, -height / 2, height / 2, shared)
      .disc(radius, height / 2, shared)
      .disc(radius, -height / 2, { ...shared, down: true })
  }
}

/* ------------------------------------------------------------------ */
/* Document assembly                                                   */
/* ------------------------------------------------------------------ */

const doc = new Document()
doc.getRoot().getAsset().generator = 'jean-portfolio-3d/scripts/make-greybox.mjs'
const buffer = doc.createBuffer('room')
const scene = doc.createScene('room')
doc.getRoot().setDefaultScene(scene)

const summary = []

function accessor(type, array) {
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
}

function material(name, hex, { roughness = 0.85, alpha = 1, emissive } = {}) {
  const [r, g, b] = hexToLinear(hex)
  const mat = doc
    .createMaterial(name)
    .setBaseColorFactor([r, g, b, alpha])
    .setMetallicFactor(0)
    .setRoughnessFactor(roughness)
  if (alpha < 1) mat.setAlphaMode('BLEND')
  if (emissive) mat.setEmissiveFactor(hexToLinear(emissive))
  return mat
}

function createPrimitive(builder, mat) {
  return doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(builder.positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(builder.normals)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(builder.uvs)))
    // Greybox: the bake UV set (UV1) simply mirrors UV0.
    .setAttribute('TEXCOORD_1', accessor('VEC2', new Float32Array(builder.uvs)))
    .setIndices(accessor('SCALAR', new Uint16Array(builder.indices)))
    .setMaterial(mat)
}

/** One primitive per [builder, material] part (three loads several as a Group of meshes). */
function createMesh(name, parts) {
  const mesh = doc.createMesh(name)
  for (const [builder, mat] of parts) mesh.addPrimitive(createPrimitive(builder, mat))
  return mesh
}

function addNode(name, { builder, mat, parts, translation, rotation, extras, parent } = {}) {
  const node = doc.createNode(name)
  const meshParts = parts ?? (builder ? [[builder, mat]] : [])
  if (meshParts.length > 0) node.setMesh(createMesh(name, meshParts))
  if (translation) node.setTranslation(round(translation, 5))
  if (rotation) node.setRotation(round(rotation, 6))
  if (extras) node.setExtras(extras)
  const container = parent ?? scene
  container.addChild(node)
  summary.push({
    node: parent ? `  └ ${name}` : name,
    tris: meshParts.reduce((sum, [part]) => sum + part.triangleCount, 0),
    translation: translation ? round(translation).join(', ') : '0, 0, 0',
    extras: extras ? JSON.stringify(extras) : '',
  })
  return node
}

/* ------------------------------------------------------------------ */
/* Materials (muted placeholder colors so the greybox reads)           */
/* ------------------------------------------------------------------ */

const M = {
  room: material('m_room', '#7b7d86'),
  floor: material('m_floor', '#5b4636'),
  desk: material('m_desk', '#8b5e3c', { roughness: 0.7 }),
  shelf: material('m_shelf', '#7a5236', { roughness: 0.75 }),
  darkPlastic: material('m_dark_plastic', '#2f3034', { roughness: 0.55 }),
  vcr: material('m_vcr', '#26272b', { roughness: 0.5 }),
  flap: material('m_vcr_flap', '#1b1c1f', { roughness: 0.45 }),
  beige: material('m_beige_plastic', '#c9bd9e', { roughness: 0.6 }),
  beigeDark: material('m_beige_plastic_dark', '#a99d80', { roughness: 0.6 }),
  keyboard: material('m_keyboard', '#d2c7aa', { roughness: 0.65 }),
  lampMetal: material('m_lamp_metal', '#2b2c30', { roughness: 0.4 }),
  lampShade: material('m_lamp_shade', '#3f5446', { roughness: 0.45 }),
  notepad: material('m_notepad', '#6b5a45'),
  page: material('m_notepad_page', '#fdf3a7', { roughness: 0.95 }),
  polaroid: material('m_polaroid', '#e8e4da', { roughness: 0.6 }),
  tvScreen: material('m_tv_screen', '#0b1030', { roughness: 0.2, emissive: '#1a2470' }),
  pcScreen: material('m_pc_screen', '#06140a', { roughness: 0.2, emissive: '#145a2a' }),
  glass: material('m_window_glass', '#8fa3c7', { roughness: 0.1, alpha: 0.06 }),
  mug: material('m_coffee_mug', '#e6dfcf', { roughness: 0.35 }),
  coffee: material('m_coffee_liquid', '#2a160b', { roughness: 0.12 }),
  clockFace: material('m_clock_face', '#eee6d3', { roughness: 0.7 }),
  clockDark: material('m_clock_rim', '#1e1f23', { roughness: 0.45 }),
  clockSecond: material('m_clock_second', '#c23b2a', { roughness: 0.5 }),
  rolodex: material('m_rolodex', '#2c3a35', { roughness: 0.5 }),
  card: material('m_index_card', '#f1ead6', { roughness: 0.9 }),
}

const TAPE_COLORS = ['#2b2b30', '#3b2f2f', '#2f3540', '#3a3a2c', '#2a3a33', '#402c35', '#33302a', '#2c2f3d']

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const ROOM = { x0: -2.6, x1: 2.6, zBack: -0.45, zFront: 3.2, height: 2.7, wall: 0.1 }
const WINDOW = { x0: -1.4, x1: 1.0, y0: 0.95, y1: 2.3 }
const DESK = { x0: -0.75, x1: 0.85, z0: -0.38, z1: 0.32, top: 0.75, thickness: 0.04 }

// The old PC sits on a chest of drawers right of the desk, turned toward the desk.
const PC_FRAME = { origin: [1.27, 0.72, 0.25], yaw: -0.22 }
const PC_QUAT = quatY(PC_FRAME.yaw)
const pcToWorld = (local) => add(PC_FRAME.origin, rotate(PC_QUAT, local))

const roomDepth = ROOM.zFront - ROOM.zBack
const roomMidZ = (ROOM.zFront + ROOM.zBack) / 2
const roomWidth = ROOM.x1 - ROOM.x0

/* static_room — walls with a window opening behind the desk, frame, ceiling */
{
  const b = new MeshBuilder()
  const { wall, height, zBack } = ROOM
  const midY = height / 2
  // Back wall around the opening.
  b.box([WINDOW.x0 - ROOM.x0, height, wall], { center: [(ROOM.x0 + WINDOW.x0) / 2, midY, zBack] })
  b.box([ROOM.x1 - WINDOW.x1, height, wall], { center: [(WINDOW.x1 + ROOM.x1) / 2, midY, zBack] })
  const openW = WINDOW.x1 - WINDOW.x0
  const openX = (WINDOW.x0 + WINDOW.x1) / 2
  b.box([openW, WINDOW.y0, wall], { center: [openX, WINDOW.y0 / 2, zBack] })
  b.box([openW, height - WINDOW.y1, wall], { center: [openX, (WINDOW.y1 + height) / 2, zBack] })
  // Side walls and ceiling.
  b.box([wall, height, roomDepth], { center: [ROOM.x0 - wall / 2, midY, roomMidZ] })
  b.box([wall, height, roomDepth], { center: [ROOM.x1 + wall / 2, midY, roomMidZ] })
  b.box([roomWidth + 2 * wall, wall, roomDepth], { center: [0, height + wall / 2, roomMidZ] })
  // Window frame: sill, jambs, head and two mullions (three panes).
  const openH = WINDOW.y1 - WINDOW.y0
  const openY = (WINDOW.y0 + WINDOW.y1) / 2
  b.box([openW + 0.1, 0.03, 0.18], { center: [openX, WINDOW.y0 - 0.015, zBack + 0.04] })
  b.box([0.05, openH, 0.12], { center: [WINDOW.x0 + 0.025, openY, zBack] })
  b.box([0.05, openH, 0.12], { center: [WINDOW.x1 - 0.025, openY, zBack] })
  b.box([openW, 0.05, 0.12], { center: [openX, WINDOW.y1 - 0.025, zBack] })
  for (const x of [WINDOW.x0 + openW / 3, WINDOW.x0 + (2 * openW) / 3]) {
    b.box([0.04, openH - 0.05, 0.07], { center: [x, openY - 0.025, zBack] })
  }
  addNode('static_room', { builder: b, mat: M.room, extras: { bake: 'room' } })
}

/* static_floor */
{
  const b = new MeshBuilder().box([roomWidth, 0.05, roomDepth], { center: [0, -0.025, roomMidZ] })
  addNode('static_floor', { builder: b, mat: M.floor, extras: { bake: 'floor' } })
}

/* static_desk — desk + chest of drawers under the PC */
{
  const b = new MeshBuilder()
  const w = DESK.x1 - DESK.x0
  const d = DESK.z1 - DESK.z0
  const cx = (DESK.x0 + DESK.x1) / 2
  const cz = (DESK.z0 + DESK.z1) / 2
  const legH = DESK.top - DESK.thickness
  b.box([w, DESK.thickness, d], { center: [cx, DESK.top - DESK.thickness / 2, cz] })
  for (const x of [DESK.x0 + 0.04, DESK.x1 - 0.04]) {
    for (const z of [DESK.z0 + 0.04, DESK.z1 - 0.04]) {
      b.box([0.05, legH, 0.05], { center: [x, legH / 2, z] })
    }
  }
  b.box([w - 0.1, 0.08, 0.02], { center: [cx, legH - 0.04, DESK.z0 + 0.03] })
  // Chest of drawers (in the PC frame): body + three drawer fronts.
  b.box([0.62, 0.72, 0.62], { center: pcToWorld([0, -0.36, 0]), rotation: PC_QUAT })
  for (const y of [-0.12, -0.36, -0.6]) {
    b.box([0.56, 0.2, 0.012], { center: pcToWorld([0, y, 0.316]), rotation: PC_QUAT })
  }
  addNode('static_desk', { builder: b, mat: M.desk, extras: { bake: 'desk' } })
}

/* static_shelf — small tape rack right of the TV */
const RACK = { x0: 0.375, x1: 0.645, z: -0.04, depth: 0.13 }
{
  const b = new MeshBuilder()
  const w = RACK.x1 - RACK.x0
  b.box([w, 0.015, RACK.depth], { center: [(RACK.x0 + RACK.x1) / 2, DESK.top + 0.0075, RACK.z] })
  for (const x of [RACK.x0 + 0.006, RACK.x1 - 0.006]) {
    b.box([0.012, 0.12, RACK.depth], { center: [x, DESK.top + 0.075, RACK.z] })
  }
  addNode('static_shelf', { builder: b, mat: M.shelf, extras: { bake: 'shelf' } })
}

/* VCR + flap (flap origin on its top hinge edge, rotates about local X) */
const VCR = { center: [0.04, DESK.top + 0.045, 0.03], size: [0.43, 0.09, 0.36] }
const vcrTop = VCR.center[1] + VCR.size[1] / 2
const vcrFront = VCR.center[2] + VCR.size[2] / 2
addNode('vcr_body', {
  builder: new MeshBuilder()
    .box(VCR.size)
    .box([0.12, 0.018, 0.004], { center: [0.12, 0.012, VCR.size[2] / 2 + 0.002] }),
  mat: M.vcr,
  translation: VCR.center,
  extras: { bake: 'gear' },
})
addNode('vcr_flap', {
  builder: new MeshBuilder().box([0.2, 0.032, 0.006], { center: [0, -0.016, 0.003] }),
  mat: M.flap,
  translation: [VCR.center[0] - 0.07, vcrTop - 0.024, vcrFront],
  extras: { bake: 'gear' },
})

/* CRT TV on the VCR: front shell + tapered tube */
const TV = { center: [0.04, vcrTop + 0.22, 0.0] }
addNode('tv_body', {
  builder: new MeshBuilder()
    .box([0.56, 0.44, 0.3], { center: [0, 0, 0.07] })
    .box([0.4, 0.34, 0.14], { center: [0, -0.05, -0.15] }),
  mat: M.darkPlastic,
  translation: TV.center,
  extras: { bake: 'gear' },
})
const TV_SCREEN = { center: [0.015, TV.center[1] + 0.015, TV.center[2] + 0.22 + 0.0015], size: [0.4, 0.3] }
addNode('tv_screen', {
  builder: new MeshBuilder().plane(TV_SCREEN.size[0], TV_SCREEN.size[1]),
  mat: M.tvScreen,
  translation: TV_SCREEN.center,
})

/* Desk lamp: base + arm (gear) and a separate head that shines along local −Y */
const LAMP = { base: [-0.55, DESK.top, -0.2], elbow: [-0.6, 1.22, -0.27], head: [-0.36, 1.33, -0.02], aim: [-0.12, DESK.top, 0.18] }
addNode('lamp_arm', {
  builder: new MeshBuilder()
    .box([0.14, 0.025, 0.14], { center: add(LAMP.base, [0, 0.0125, 0]) })
    .beam(add(LAMP.base, [0, 0.025, 0]), LAMP.elbow, 0.018)
    .beam(LAMP.elbow, sub(LAMP.head, scale(normalize(sub(LAMP.head, LAMP.elbow)), 0.05)), 0.016),
  mat: M.lampMetal,
  extras: { bake: 'gear' },
})
addNode('lamp_head', {
  builder: new MeshBuilder()
    .box([0.12, 0.1, 0.12], { center: [0, -0.02, 0] })
    .box([0.06, 0.04, 0.06], { center: [0, 0.05, 0] }),
  mat: M.lampShade,
  translation: LAMP.head,
  rotation: quatFromUnitVectors([0, -1, 0], normalize(sub(LAMP.aim, LAMP.head))),
  extras: { bake: 'gear' },
})

/* VHS tapes standing like books in the rack (spines face +Z) */
const TAPE = { size: [0.025, 0.187, 0.102], gap: 0.003 }
for (let i = 0; i < 8; i++) {
  const slot = i + 1
  const x = RACK.x0 + 0.012 + 0.0125 + TAPE.size[0] / 2 + i * (TAPE.size[0] + TAPE.gap)
  addNode(`tape_${String(slot).padStart(2, '0')}`, {
    builder: new MeshBuilder().box(TAPE.size),
    mat: material(`m_tape_${slot}`, TAPE_COLORS[i], { roughness: 0.5 }),
    translation: [x, DESK.top + 0.015 + TAPE.size[1] / 2, RACK.z],
    extras: { bake: 'shelf', slot },
  })
}

/* Notepad lying on the desk; the page (child) is on the pad's local +Z face */
{
  const notepad = addNode('notepad', {
    builder: new MeshBuilder()
      .box([0.16, 0.26, 0.008])
      .box([0.16, 0.018, 0.012], { center: [0, 0.121, 0.002] }),
    mat: M.notepad,
    translation: [0.72, DESK.top + 0.004, 0.17],
    rotation: quatMultiply(quatY(0.1), quatX(-Math.PI / 2)),
    extras: { bake: 'props' },
  })
  addNode('notepad_page', {
    builder: new MeshBuilder().plane(0.148, 0.2405),
    mat: M.page,
    translation: [0, -0.008, 0.0045],
    extras: { bake: 'props' },
    parent: notepad,
  })
}

/* Old PC on the chest (all parts share the PC frame) */
addNode('pc_body', {
  builder: new MeshBuilder()
    .box([0.5, 0.13, 0.4])
    .box([0.14, 0.012, 0.004], { center: [0.14, 0.02, 0.202] }),
  mat: M.beigeDark,
  translation: pcToWorld([0, 0.065, -0.08]),
  rotation: PC_QUAT,
  extras: { bake: 'gear' },
})
const PC_MONITOR_LOCAL = [0.04, 0.3, -0.02]
addNode('pc_monitor', {
  builder: new MeshBuilder()
    .box([0.38, 0.34, 0.24])
    .box([0.28, 0.26, 0.14], { center: [0, -0.02, -0.19] }),
  mat: M.beige,
  translation: pcToWorld(PC_MONITOR_LOCAL),
  rotation: PC_QUAT,
  extras: { bake: 'gear' },
})
addNode('pc_screen', {
  builder: new MeshBuilder().plane(0.27, 0.2025),
  mat: M.pcScreen,
  translation: pcToWorld([0.04, 0.315, 0.1015]),
  rotation: PC_QUAT,
})
addNode('pc_keyboard', {
  builder: new MeshBuilder().box([0.44, 0.03, 0.15]),
  mat: M.keyboard,
  translation: pcToWorld([0.02, 0.02, 0.21]),
  rotation: quatMultiply(PC_QUAT, quatX(0.06)),
  extras: { bake: 'gear' },
})

/* Polaroid leaning on the PC case, left of the monitor */
{
  const lean = -0.2
  const h = 0.107
  addNode('polaroid_photo', {
    builder: new MeshBuilder().plane(0.088, h),
    mat: M.polaroid,
    translation: pcToWorld([-0.2, 0.13 + (h / 2) * Math.cos(lean), 0.05 + (h / 2) * Math.sin(lean)]),
    rotation: quatMultiply(PC_QUAT, quatX(lean)),
  })
}

/*
 * Coffee mug on the desk, left of the TV near the front edge (origin: bottom
 * centre; handle on local +X, yawed toward the home camera). Not baked: it
 * lifts for a sip. The child `coffee_liquid` is the coffee's top disc.
 */
const MUG = { position: [-0.35, DESK.top, 0.09], yaw: -0.5, radius: 0.04, wall: 0.004, height: 0.095, floor: 0.008 }
{
  const { radius, wall, height, floor } = MUG
  const inner = radius - wall
  const body = new MeshBuilder()
    .wall(radius, 0, height, { segments: 24 })
    .wall(inner, floor, height, { segments: 24, inward: true })
    .disc(radius, height, { inner, segments: 24 })
    .disc(radius, 0, { down: true, segments: 24 })
    .disc(inner, floor, { segments: 24 })
  // C-shaped handle on +X: beams along a half circle.
  const handle = { center: [radius + 0.004, height * 0.52, 0], radius: 0.026, thickness: 0.009, steps: 7 }
  const arc = Array.from({ length: handle.steps + 1 }, (_, i) => {
    const angle = -Math.PI / 2 + (i / handle.steps) * Math.PI
    return add(handle.center, [Math.cos(angle) * handle.radius * 0.8, Math.sin(angle) * handle.radius, 0])
  })
  for (let i = 0; i < handle.steps; i++) body.beam(arc[i], arc[i + 1], handle.thickness)
  const mug = addNode('coffee_mug', {
    builder: body,
    mat: M.mug,
    translation: MUG.position,
    rotation: quatY(MUG.yaw),
  })
  // Full: 85% of the inside height.
  const level = floor + (height - floor) * 0.85
  addNode('coffee_liquid', {
    builder: new MeshBuilder().disc(inner - 0.0006, 0, { segments: 24 }),
    mat: M.coffee,
    translation: [0, level, 0],
    parent: mug,
  })
}

/*
 * Rolodex (card file) on the desk in front of the lamp: a tray, two knobs,
 * a fan of index cards and one card standing open. The credits card floats
 * up from it. Origin: bottom centre, front (+Z) yawed toward the camera.
 */
{
  const tray = new MeshBuilder()
    .box([0.13, 0.034, 0.09], { center: [0, 0.017, 0] })
    .beam([-0.066, 0.036, 0], [0.066, 0.036, 0], 0.006)
  for (const x of [-0.071, 0.071]) {
    tray.cylinder(0.021, 0.01, { center: [x, 0.036, 0], rotation: quatAxisAngle([0, 0, 1], Math.PI / 2), segments: 16 })
  }
  const cards = new MeshBuilder()
  const pivot = [0, 0.03, 0]
  const card = [0.11, 0.066, 0.0016]
  for (const angle of [-0.62, -0.46, -0.3, 0.32, 0.48, 0.64]) {
    const tilt = quatX(angle)
    cards.box(card, { center: add(pivot, rotate(tilt, [0, card[1] / 2, 0])), rotation: tilt })
  }
  // The open card: upright and raised a little out of the fan.
  cards.box(card, { center: add(pivot, [0, card[1] / 2 + 0.012, 0.002]), rotation: quatX(-0.06) })
  addNode('rolodex', {
    parts: [
      [tray, M.rolodex],
      [cards, M.card],
    ],
    translation: [-0.64, DESK.top, 0.0],
    rotation: quatY(0.26),
    extras: { bake: 'props' },
  })
}

/*
 * Wall clock on the back wall right of the PC monitor, where the #about /
 * #online view sees bare wall (the home and #work frames only see glass
 * above the desk). Face toward the room (+Z); the hands are children with
 * their origin on the centre, pointing to 12 (local +Y), turning about +Z.
 */
const CLOCK = { position: [1.93, 1.19, ROOM.zBack + ROOM.wall / 2 + 0.03], radius: 0.088 }
{
  const { radius } = CLOCK
  const faceOn = quatX(Math.PI / 2) // local +Y of the round parts → +Z (out of the wall)
  const face = new MeshBuilder().disc(radius - 0.004, 0, { rotation: faceOn, segments: 32 })
  const dark = new MeshBuilder()
    .wall(radius, -0.03, 0.008, { rotation: faceOn, segments: 32 })
    .wall(radius - 0.004, 0, 0.008, { rotation: faceOn, segments: 32, inward: true })
    .disc(radius, 0.008, { inner: radius - 0.004, rotation: faceOn, segments: 32 })
    .cylinder(0.0055, 0.004, { center: [0, 0, 0.0095], rotation: faceOn, segments: 12 })
  for (let i = 0; i < 12; i++) {
    const major = i % 3 === 0
    const turn = quatAxisAngle([0, 0, 1], (-i * Math.PI) / 6)
    const size = major ? [0.007, 0.018, 0.0016] : [0.0035, 0.011, 0.0016]
    const r = radius - 0.016 - (major ? 0.0035 : 0)
    dark.box(size, { center: rotate(turn, [0, r, 0.0008]), rotation: turn })
  }
  const clock = addNode('wall_clock', {
    parts: [
      [face, M.clockFace],
      [dark, M.clockDark],
    ],
    translation: CLOCK.position,
  })
  const hand = (name, [width, length, tail], z, mat) =>
    addNode(name, {
      builder: new MeshBuilder().box([width, length + tail, 0.0014], { center: [0, (length - tail) / 2, 0] }),
      mat,
      translation: [0, 0, z],
      parent: clock,
    })
  hand('clock_hour', [0.0075, 0.046, 0.008], 0.0024, M.clockDark)
  hand('clock_minute', [0.005, 0.068, 0.01], 0.0042, M.clockDark)
  hand('clock_second', [0.0018, 0.074, 0.016], 0.006, M.clockSecond)
}

/* Window glass in the opening */
const GLASS_CENTER = [(WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, ROOM.zBack - 0.01]
addNode('window_glass', {
  builder: new MeshBuilder().plane(WINDOW.x1 - WINDOW.x0, WINDOW.y1 - WINDOW.y0),
  mat: M.glass,
  translation: GLASS_CENTER,
})

/* Anchors (empties) */
const workCamera = add(WORK_FRAME.target, scale(normalize(WORK_FRAME.dir), WORK_FRAME.distance))
const NOTEPAD_UP = [0.56, 1.06, 0.3]
addNode('anchor_notepad_up', {
  translation: NOTEPAD_UP,
  // Local +Z (the page normal) faces the work camera.
  rotation: quatFacing(sub(workCamera, NOTEPAD_UP)),
})
addNode('anchor_city', { translation: add(GLASS_CENTER, [0, 0, -1.0]) })

/* ------------------------------------------------------------------ */
/* Write + report                                                      */
/* ------------------------------------------------------------------ */

await mkdir(dirname(OUT_FILE), { recursive: true })
await new NodeIO().write(OUT_FILE, doc)
const { size } = await stat(OUT_FILE)

const totalTris = summary.reduce((sum, row) => sum + row.tris, 0)
console.table(summary)
console.log(`\nWrote ${relative(ROOT, OUT_FILE)} — ${summary.length} nodes, ${totalTris} triangles, ${(size / 1024).toFixed(1)} KiB`)
console.log('Key coordinates (world, m):')
console.log('  tv_body centre      ', round(TV.center))
console.log('  tv_screen centre    ', round(TV_SCREEN.center))
console.log('  pc_monitor centre   ', round(pcToWorld(PC_MONITOR_LOCAL)), `yaw ${PC_FRAME.yaw} rad`)
console.log('  anchor_notepad_up   ', round(NOTEPAD_UP), '→ faces work camera', round(workCamera))
console.log('  anchor_city         ', round(add(GLASS_CENTER, [0, 0, -1.0])))
console.log('  coffee_mug          ', round(MUG.position))
console.log('  wall_clock centre   ', round(CLOCK.position))
