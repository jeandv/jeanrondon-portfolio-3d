import {
  CanvasTexture,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Object3D,
  type Texture,
} from 'three'
import { tapeBySlot, tapeNodeName } from '../../../content/work'
import { BAKE_GROUPS, IRR_SCALE, isGroupBaked, type BakeGroup } from '../../materials/baked'
import { LAMP_MIX, lampOffBake, mixedIrradiance } from '../../materials/lampMix'
import { nodeSpaceBounds } from '../bounds'
import { restPose } from '../motion'
import { ATLAS_SIZE, atlasRow, drawLabelAtlas, type AtlasEntry } from './labelAtlas'
import { decalSource, geometrySource, LabelBatch, type LabelSource } from './labelBatch'
import { axisVector, labelPlacement, tapeShape, type TapeShape } from './rig'

/**
 * The spine labels of every tape on the shelf (content tapes get their title,
 * empty slots a blank label): one atlas texture, one batched mesh, one draw call.
 *
 * Lighting, kept consistent with the tape under it:
 *   greybox → MeshStandardMaterial (same realtime lights as the tape),
 *   baked   → MeshBasicMaterial × the tape spine's own irradiance, sampled
 *             once from the shelf irrA (and irrB) at the spine's UV1 and mixed
 *             with the lamp like the baked shader does. A per-label vertex
 *             colour carries that brightness and the hover bump.
 */

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const HOVER_GAIN = { baked: 1.2, greybox: 1.18 } as const

interface LabelTarget {
  readonly slot: number
  readonly node: Object3D
  readonly shape: TapeShape
  readonly group: BakeGroup | undefined
  /** Spine UV1 (baked lookups), null if none found. */
  readonly uv1: Vector2 | null
  irrA: [number, number, number] | null
  irrB: [number, number, number] | null
}

export interface TapeLabels {
  readonly mesh: Mesh
  /** Draws the atlas (call once the screen fonts are loaded). */
  draw(): void
  /** Per frame: follow the tapes, tint for lighting / hover. */
  update(hoveredNode: string | null): void
  dispose(): void
}

function bakeGroupOf(node: Object3D): BakeGroup | undefined {
  const bake: unknown = node.userData.bake
  return typeof bake === 'string' && (BAKE_GROUPS as readonly string[]).includes(bake) ? (bake as BakeGroup) : undefined
}

/** Area-weighted UV1 centroid of the faces pointing along `normal` (node space). */
export function spineUv1(node: Object3D, normal: Vector3): Vector2 | null {
  node.updateWorldMatrix(true, true)
  const toNode = new Matrix4().copy(node.matrixWorld).invert()
  const sum = new Vector2()
  let weight = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const face = new Vector3()
  node.traverse((child) => {
    if (!(child instanceof Mesh) || child.userData.hotspotProxy === true || child.userData.runtimeHelper === true) return
    const position = child.geometry.getAttribute('position') as BufferAttribute | undefined
    const uv1 = child.geometry.getAttribute('uv1') as BufferAttribute | undefined
    if (!position || !uv1) return
    const matrix = new Matrix4().multiplyMatrices(toNode, child.matrixWorld)
    const index = child.geometry.index
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count; i += 3) {
      const [ia, ib, ic] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]
      a.fromBufferAttribute(position, ia).applyMatrix4(matrix)
      b.fromBufferAttribute(position, ib).applyMatrix4(matrix)
      c.fromBufferAttribute(position, ic).applyMatrix4(matrix)
      face.subVectors(c, b).cross(a.clone().sub(b))
      const area = face.length() / 2
      if (area <= 0 || face.normalize().dot(normal) < 0.9) continue
      sum.x += ((uv1.getX(ia) + uv1.getX(ib) + uv1.getX(ic)) / 3) * area
      sum.y += ((uv1.getY(ia) + uv1.getY(ib) + uv1.getY(ic)) / 3) * area
      weight += area
    }
  })
  return weight > 0 ? sum.divideScalar(weight) : null
}

const SAMPLE_SIZE = 64
const samples = new WeakMap<object, Uint8ClampedArray>()

const srgbToLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Linear RGB of a texture's image at UV (glTF orientation), from a 64² copy read once. */
export function sampleTexture(texture: Texture, uv: Vector2): [number, number, number] | null {
  const image: unknown = texture.image
  if (!image || typeof image !== 'object' || !('width' in image) || !(Number(image.width) > 0)) return null
  let data = samples.get(image)
  if (!data) {
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(image as CanvasImageSource, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    data = g.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
    samples.set(image, data)
  }
  // flipY = false: v = 0 is the image's first row.
  const x = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(uv.x * SAMPLE_SIZE)))
  const y = Math.min(SAMPLE_SIZE - 1, Math.max(0, Math.floor(uv.y * SAMPLE_SIZE)))
  const i = (y * SAMPLE_SIZE + x) * 4
  return [srgbToLinear(data[i] ?? 0), srgbToLinear(data[i + 1] ?? 0), srgbToLinear(data[i + 2] ?? 0)]
}

/** The irradiance lightMap of a baked node's first mesh (null in greybox). */
export function lightMapOf(node: Object3D): Texture | null {
  let found: Texture | null = null
  node.traverse((child) => {
    if (found || !(child instanceof Mesh) || child.userData.hotspotProxy === true) return
    const material = Array.isArray(child.material) ? child.material[0] : child.material
    if (material instanceof MeshBasicMaterial && material.lightMap) found = material.lightMap
  })
  return found
}

function createAtlasTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE
  const texture = new CanvasTexture(canvas)
  texture.name = 'tape_labels'
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.anisotropy = 8
  return texture
}

/** Null when the GLB has no tape nodes. */
export function createTapeLabels(room: Object3D, viewer: Vector3): TapeLabels | null {
  const targets: LabelTarget[] = []
  const sources: LabelSource[] = []
  const hiddenLabels: Object3D[] = []
  let aspect = 0

  for (const slot of SLOTS) {
    const node = room.getObjectByName(tapeNodeName(slot))
    if (!node) continue
    const rest = restPose(node)
    node.parent?.updateWorldMatrix(true, false)
    const restWorld = (node.parent?.matrixWorld.clone() ?? new Matrix4()).multiply(
      new Matrix4().compose(rest.position, rest.quaternion, node.scale),
    )
    const shape = tapeShape(nodeSpaceBounds(node), restWorld, viewer)
    const row = atlasRow(slot)
    const authored = room.getObjectByName(`${tapeNodeName(slot)}_label`)
    if (authored instanceof Mesh) {
      authored.updateWorldMatrix(true, false)
      const toNode = restWorld.clone().invert().multiply(authored.matrixWorld)
      sources.push(geometrySource(authored.geometry, toNode, row))
      authored.geometry.computeBoundingBox()
      const size = authored.geometry.boundingBox?.getSize(new Vector3()).multiply(authored.getWorldScale(new Vector3()))
      const sides = size ? [size.x, size.y, size.z].sort((p, q) => q - p) : []
      if (!aspect && sides[0] && sides[1]) aspect = sides[0] / sides[1]
      // Drawn by the batch instead (hidden every frame, restored on dispose).
      hiddenLabels.push(authored)
    } else {
      const placement = labelPlacement(shape, node.scale)
      sources.push(decalSource(placement, row))
      if (!aspect) aspect = placement.aspect
    }
    const group = bakeGroupOf(node)
    targets.push({
      slot,
      node,
      shape,
      group,
      uv1: group && isGroupBaked(group) ? spineUv1(node, axisVector(shape.normal)) : null,
      irrA: null,
      irrB: null,
    })
  }
  if (targets.length === 0) return null

  const baked = targets.some((target) => target.group !== undefined && isGroupBaked(target.group))
  const texture = createAtlasTexture()
  const common = {
    name: 'M_tape_labels',
    map: texture,
    vertexColors: true,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }
  const material = baked
    ? new MeshBasicMaterial(common)
    : new MeshStandardMaterial({ ...common, roughness: 0.82, metalness: 0 })
  const batch = new LabelBatch(sources, material)
  const entries: AtlasEntry[] = targets.map(({ slot }) => {
    const tape = tapeBySlot(slot)
    return tape ? { slot, tape } : { slot }
  })

  const bakedTint = (target: LabelTarget, gain: number): [number, number, number] => {
    if (!target.uv1 || !target.group) return [gain, gain, gain]
    if (!target.irrA) {
      const irrA = lightMapOf(target.node)
      target.irrA = irrA ? sampleTexture(irrA, target.uv1) : null
    }
    if (!target.irrB) {
      const irrB = lampOffBake(target.group)
      target.irrB = irrB ? sampleTexture(irrB, target.uv1) : null
    }
    const irrA = target.irrA
    if (!irrA) return [gain, gain, gain]
    const mix = LAMP_MIX.value
    return [0, 1, 2].map((c) => mixedIrradiance(irrA[c] ?? 0, target.irrB?.[c] ?? null, mix) * IRR_SCALE * gain) as [
      number,
      number,
      number,
    ]
  }

  return {
    mesh: batch.mesh,
    draw() {
      drawLabelAtlas(texture.image as HTMLCanvasElement, entries, aspect || 9)
      texture.needsUpdate = true
    },
    update(hoveredNode) {
      for (const node of hiddenLabels) node.visible = false
      targets.forEach((target, index) => {
        target.node.updateWorldMatrix(true, false)
        batch.place(index, target.node.matrixWorld, target.node.visible)
        const hovered = hoveredNode === target.node.name
        if (baked) {
          const [r, g, b] = bakedTint(target, hovered ? HOVER_GAIN.baked : 1)
          batch.tint(index, r, g, b)
        } else {
          const gain = hovered ? HOVER_GAIN.greybox : 1
          batch.tint(index, gain, gain, gain)
        }
      })
      batch.commit()
    },
    dispose() {
      for (const node of hiddenLabels) node.visible = true
      batch.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
