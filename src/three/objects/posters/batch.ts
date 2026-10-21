import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import type { PosterQuad, UvRect } from './layout'

/**
 * Every poster in ONE indexed geometry (one draw call): a gently curled sheet
 * per poster (a grid that bulges off the wall between its taped corners, the
 * bottom edge lifting a little), or a Blender `poster_<id>` plane, its UVs
 * mapped into the poster's atlas rectangle. Static: built once, only the
 * per-poster vertex colour (lighting tint, hover) changes afterwards.
 */

export interface PosterSource {
  /** World space. */
  readonly positions: Float32Array
  readonly uvs: Float32Array
  readonly indices: readonly number[]
}

/** Grid resolution of a generated sheet (enough for a smooth curl, 160 triangles). */
export const CURL_SEGMENTS = { x: 8, y: 10 } as const

export interface CurlSpec {
  /** Bulge (m) in the middle of the sheet. */
  readonly bulge: number
  /** How far (m) the bottom edge lifts off the wall. */
  readonly lift: number
  /** One corner peels a little more: -1 left, 1 right. */
  readonly peel: number
}

/** Off-the-wall offset (m) at sheet coordinates u (left → right) and v (top → bottom), pure. */
export function curlOffset(u: number, v: number, curl: CurlSpec): number {
  const bulge = curl.bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
  const bottom = Math.max(0, (v - 0.72) / 0.28) ** 2
  const side = curl.peel < 0 ? 1 - u : u
  return bulge + curl.lift * bottom * (0.55 + 0.45 * side)
}

const add = (out: Vector3, axis: readonly [number, number, number], scale: number) =>
  out.set(out.x + axis[0] * scale, out.y + axis[1] * scale, out.z + axis[2] * scale)

/** A curled sheet on its wall, UVs in `uv` (v down). */
export function curledSource(quad: PosterQuad, uv: UvRect, curl: CurlSpec): PosterSource {
  const { x: sx, y: sy } = CURL_SEGMENTS
  const positions = new Float32Array((sx + 1) * (sy + 1) * 3)
  const uvs = new Float32Array((sx + 1) * (sy + 1) * 2)
  const p = new Vector3()
  for (let j = 0; j <= sy; j++) {
    for (let i = 0; i <= sx; i++) {
      const u = i / sx
      const v = j / sy
      p.set(...quad.center)
      add(p, quad.right, (u - 0.5) * quad.width)
      add(p, quad.up, (0.5 - v) * quad.height)
      add(p, quad.normal, curlOffset(u, v, curl))
      const k = j * (sx + 1) + i
      p.toArray(positions, k * 3)
      uvs[k * 2] = uv.u0 + u * (uv.u1 - uv.u0)
      uvs[k * 2 + 1] = uv.v0 + v * (uv.v1 - uv.v0)
    }
  }
  const indices: number[] = []
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      const tl = j * (sx + 1) + i
      const tr = tl + 1
      const bl = tl + sx + 1
      const br = bl + 1
      // Counter-clockwise seen from the room (right × up = the wall normal).
      indices.push(bl, br, tr, bl, tr, tl)
    }
  }
  return { positions, uvs, indices }
}

/** A Blender `poster_<id>` plane (UV0 0..1, v down as exported) in world space, UVs mapped into `uv`. */
export function planeSource(geometry: BufferGeometry, matrixWorld: Matrix4, uv: UvRect): PosterSource {
  const position = geometry.getAttribute('position')
  const uv0 = geometry.getAttribute('uv')
  const count = position.count
  const positions = new Float32Array(count * 3)
  const uvs = new Float32Array(count * 2)
  const p = new Vector3()
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(matrixWorld).toArray(positions, i * 3)
    const u = uv0 ? uv0.getX(i) : 0.5
    const v = uv0 ? uv0.getY(i) : 0.5
    uvs[i * 2] = uv.u0 + u * (uv.u1 - uv.u0)
    uvs[i * 2 + 1] = uv.v0 + v * (uv.v1 - uv.v0)
  }
  const index = geometry.index
  const indices = index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : Array.from({ length: count }, (_, i) => i)
  return { positions, uvs, indices }
}

export interface PosterBatch {
  readonly geometry: BufferGeometry
  /** Triangle range of each source (for picking: faceIndex → poster). */
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly count: number }>
  /** Vertex range of each source (for its tint). */
  readonly vertices: ReadonlyArray<{ readonly start: number; readonly count: number }>
}

/** Merges the sources (normals computed from the curl), with a white vertex colour per poster. */
export function buildPosterBatch(sources: readonly PosterSource[]): PosterBatch {
  const vertexCount = sources.reduce((sum, source) => sum + source.positions.length / 3, 0)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const colors = new Float32Array(vertexCount * 3).fill(1)
  const indices: number[] = []
  const ranges: Array<{ start: number; count: number }> = []
  const vertices: Array<{ start: number; count: number }> = []
  let base = 0
  for (const source of sources) {
    const count = source.positions.length / 3
    positions.set(source.positions, base * 3)
    uvs.set(source.uvs, base * 2)
    ranges.push({ start: indices.length / 3, count: source.indices.length / 3 })
    vertices.push({ start: base, count })
    for (const index of source.indices) indices.push(index + base)
    base += count
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, ranges, vertices }
}

/** Which source a picked triangle belongs to (-1: none). */
export function sourceOfFace(ranges: PosterBatch['ranges'], faceIndex: number): number {
  return ranges.findIndex((range) => faceIndex >= range.start && faceIndex < range.start + range.count)
}
