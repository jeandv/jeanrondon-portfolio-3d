import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Matrix3,
  Matrix4,
  Mesh,
  Vector3,
  type Material,
} from 'three'
import { remapToRow, rowUv } from './labelAtlas'
import type { LabelPlacement } from './rig'

/**
 * Every spine label in ONE draw call: a non-indexed triangle list whose
 * vertices are rewritten (CPU, a few dozen) whenever a tape moves. Each label
 * is authored in its tape's node space; the batch mesh sits at the scene root
 * with an identity transform.
 */

export interface LabelSource {
  /** Triangle list in the tape's node space. */
  readonly positions: Float32Array
  readonly normals: Float32Array
  /** Atlas UVs (already in the tape's row). */
  readonly uvs: Float32Array
}

/** Auto decal: one quad on the spine (two triangles), UVs mapped to `row`. */
export function decalSource(placement: LabelPlacement, row: number): LabelSource {
  const { center, xAxis, yAxis, normal, width, height } = placement
  const corner = (sx: number, sy: number) =>
    center.clone().addScaledVector(xAxis, (sx * width) / 2).addScaledVector(yAxis, (sy * height) / 2)
  const rect = rowUv(row)
  // Text starts at −x; the glyph tops are +y (v = 0 at the top, glTF orientation).
  const bl = { p: corner(-1, -1), uv: remapToRow(0, 1, rect) }
  const br = { p: corner(1, -1), uv: remapToRow(1, 1, rect) }
  const tr = { p: corner(1, 1), uv: remapToRow(1, 0, rect) }
  const tl = { p: corner(-1, 1), uv: remapToRow(0, 0, rect) }
  const order = [bl, br, tr, bl, tr, tl]
  return {
    positions: new Float32Array(order.flatMap(({ p }) => p.toArray())),
    normals: new Float32Array(order.flatMap(() => normal.toArray())),
    uvs: new Float32Array(order.flatMap(({ uv }) => uv)),
  }
}

/**
 * A Blender `tape_NN_label` plane (UV0 0..1) re-expressed in the tape's node
 * space (`toNode`: label → tape node), its UVs mapped to `row`.
 */
export function geometrySource(geometry: BufferGeometry, toNode: Matrix4, row: number): LabelSource {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  if (!flat.getAttribute('normal')) flat.computeVertexNormals()
  flat.applyMatrix4(toNode)
  const position = flat.getAttribute('position')
  const normal = flat.getAttribute('normal')
  const uv = flat.getAttribute('uv')
  const rect = rowUv(row)
  const count = position.count
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3)
    normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3)
    const [u, v] = uv ? remapToRow(uv.getX(i), uv.getY(i), rect) : remapToRow(0.5, 0.5, rect)
    uvs.set([u, v], i * 2)
  }
  flat.dispose()
  return { positions, normals, uvs }
}

interface Slot {
  readonly start: number
  readonly count: number
  readonly source: LabelSource
  readonly last: Float32Array
  visible: boolean
}

const point = new Vector3()
const normalMatrix = new Matrix3()

export class LabelBatch {
  readonly geometry = new BufferGeometry()
  readonly mesh: Mesh
  private readonly slots: Slot[] = []
  private readonly position: BufferAttribute
  private readonly normal: BufferAttribute
  private readonly color: BufferAttribute
  private positionsDirty = false
  private colorsDirty = false

  constructor(sources: readonly LabelSource[], material: Material) {
    let start = 0
    for (const source of sources) {
      const count = source.positions.length / 3
      this.slots.push({ start, count, source, last: new Float32Array(16).fill(Number.NaN), visible: true })
      start += count
    }
    this.position = new BufferAttribute(new Float32Array(start * 3), 3)
    this.normal = new BufferAttribute(new Float32Array(start * 3), 3)
    this.color = new BufferAttribute(new Float32Array(start * 3).fill(1), 3)
    const uv = new BufferAttribute(new Float32Array(start * 2), 2)
    for (const slot of this.slots) uv.array.set(slot.source.uvs, slot.start * 2)
    for (const attribute of [this.position, this.normal, this.color]) attribute.setUsage(DynamicDrawUsage)
    this.geometry.setAttribute('position', this.position)
    this.geometry.setAttribute('normal', this.normal)
    this.geometry.setAttribute('uv', uv)
    this.geometry.setAttribute('color', this.color)
    this.mesh = new Mesh(this.geometry, material)
    this.mesh.name = 'tape_labels'
    // Vertices move every frame a tape flies: skip culling rather than refit bounds.
    this.mesh.frustumCulled = false
    this.mesh.userData.runtimeHelper = true
    this.mesh.matrixAutoUpdate = false
  }

  get size(): number {
    return this.slots.length
  }

  /** Puts label `index` where its tape is (`matrixWorld`); hidden labels collapse to a point. */
  place(index: number, matrixWorld: Matrix4, visible: boolean): void {
    const slot = this.slots[index]
    if (!slot) return
    const elements = matrixWorld.elements
    if (visible === slot.visible && elements.every((value, i) => value === slot.last[i])) return
    slot.last.set(elements)
    slot.visible = visible
    const positions = this.position.array
    const normals = this.normal.array
    const { source, start, count } = slot
    if (!visible) {
      positions.fill(0, start * 3, (start + count) * 3)
    } else {
      normalMatrix.getNormalMatrix(matrixWorld)
      for (let i = 0; i < count; i++) {
        point.fromArray(source.positions, i * 3).applyMatrix4(matrixWorld).toArray(positions, (start + i) * 3)
        point.fromArray(source.normals, i * 3).applyMatrix3(normalMatrix).normalize().toArray(normals, (start + i) * 3)
      }
    }
    this.positionsDirty = true
  }

  /** Per-label colour (linear), multiplied into the atlas: baked irradiance and hover. */
  tint(index: number, r: number, g: number, b: number): void {
    const slot = this.slots[index]
    if (!slot) return
    const colors = this.color.array
    const at = slot.start * 3
    if (colors[at] === r && colors[at + 1] === g && colors[at + 2] === b) return
    for (let i = 0; i < slot.count; i++) colors.set([r, g, b], (slot.start + i) * 3)
    this.colorsDirty = true
  }

  /** Flags the attributes that changed for upload. */
  commit(): void {
    if (this.positionsDirty) {
      this.position.needsUpdate = true
      this.normal.needsUpdate = true
    }
    if (this.colorsDirty) this.color.needsUpdate = true
    this.positionsDirty = false
    this.colorsDirty = false
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
