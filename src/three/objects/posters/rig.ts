import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Object3D,
  type Texture,
} from 'three'
import type { Poster } from '../../../content/posters'
import { POSTER_PREFIX } from '../../contract'
import { IRR_SCALE, isGroupBaked } from '../../materials/baked'
import { LAMP_MIX, lampOffBake, mixedIrradiance } from '../../materials/lampMix'
import { hashId, random } from '../tapes/labelAtlas'
import { lightMapOf, sampleTexture } from '../tapes/labels'
import { drawPoster, drawPosterImage } from './art'
import { buildPosterBatch, curledSource, planeSource, sourceOfFace, type PosterSource } from './batch'
import { posterAtlas, posterQuad, rectUv, type AtlasSpec, type PosterQuad } from './layout'

/**
 * The posters' runtime: one atlas canvas, one batched mesh, one draw call.
 * Lighting follows the tape labels: greybox → MeshStandardMaterial under the
 * same realtime lights as the walls; baked → MeshBasicMaterial × the wall's
 * own irradiance behind each poster (sampled once from the room's irrA / irrB
 * at the wall's UV1, mixed with the lamp like the baked shader). A vertex
 * colour per poster carries that tint and the hover bump.
 */

/** Optional owner images: src/assets/posters/<id>.(jpg|jpeg|png|webp). */
const OVERRIDE_FILES = import.meta.glob<string>('../../../assets/posters/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const OVERRIDE_FILE = /\/([a-z0-9-]+)\.(jpe?g|png|webp)$/

/** Override image URL per poster id (pure; the first file wins when several share an id). */
export function overrideUrls(files: Readonly<Record<string, string>>, ids: readonly string[]): Map<string, string> {
  const known = new Set(ids)
  const urls = new Map<string, string>()
  for (const [path, url] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const id = OVERRIDE_FILE.exec(path)?.[1]
    if (id && known.has(id) && !urls.has(id)) urls.set(id, url)
  }
  return urls
}

/** Blender override node of a poster (contract.ts). */
export const posterNodeName = (id: string) => `${POSTER_PREFIX}${id}`

const HOVER_GAIN = 1.12

interface Target {
  readonly poster: Poster
  readonly quad: PosterQuad
  /** Irradiance of the wall behind it (baked), linear RGB; null in greybox. */
  irrA: [number, number, number] | null
  irrB: [number, number, number] | null
  readonly uv1: Vector2 | null
}

export interface PosterRig {
  readonly mesh: Mesh
  /** Draws the generated art (call once the screen fonts are in); then the owner images as they load. */
  draw(): () => void
  /** The poster under a picked triangle. */
  posterAt(faceIndex: number | null | undefined): Poster | null
  /** Per frame: lamp tint (baked) and hover bump. */
  update(hoveredId: string | null): void
  dispose(): void
}

/** Wall UV1 behind a point (raycast against the baked room), or null. */
function wallUv1(room: Object3D, quad: PosterQuad): Vector2 | null {
  const wall = room.getObjectByName('static_room')
  if (!wall) return null
  const normal = new Vector3(...quad.normal)
  const origin = new Vector3(...quad.center).addScaledVector(normal, 0.05)
  const hit = new Raycaster(origin, normal.clone().negate(), 0, 0.2).intersectObject(wall, true)[0]
  return hit?.uv1 ? hit.uv1.clone() : null
}

function createTexture(atlas: AtlasSpec): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = atlas.width
  canvas.height = atlas.height
  const texture = new CanvasTexture(canvas)
  texture.name = 'posters'
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  return texture
}

export function createPosterRig(room: Object3D, posters: readonly Poster[], atlas: AtlasSpec): PosterRig {
  const layout = posterAtlas(posters, atlas)
  const hidden: Object3D[] = []
  const sources: PosterSource[] = []
  const targets: Target[] = posters.map((poster, i) => {
    const rect = layout.rects[i] ?? { x: 0, y: 0, w: 1, h: 1 }
    const uv = rectUv(rect, atlas)
    const quad = posterQuad(poster.slot, poster.size)
    const authored = room.getObjectByName(posterNodeName(poster.id))
    if (authored instanceof Mesh) {
      authored.updateWorldMatrix(true, false)
      sources.push(planeSource(authored.geometry, authored.matrixWorld, uv))
      hidden.push(authored)
    } else {
      const rand = random(hashId(poster.id))
      const taped = poster.kind === 'tribute'
      sources.push(
        curledSource(quad, uv, {
          bulge: taped ? 0.004 + rand() * 0.003 : 0.0015,
          lift: taped ? 0.006 + rand() * 0.008 : 0.002,
          peel: rand() < 0.5 ? -1 : 1,
        }),
      )
    }
    return { poster, quad, irrA: null, irrB: null, uv1: isGroupBaked('room') ? wallUv1(room, quad) : null }
  })

  const batch = buildPosterBatch(sources)
  const texture = createTexture(atlas)
  const baked = isGroupBaked('room')
  const common = { name: 'M_posters', map: texture, vertexColors: true, alphaTest: 0.5 }
  const material = baked ? new MeshBasicMaterial(common) : new MeshStandardMaterial({ ...common, roughness: 0.84, metalness: 0 })
  const mesh = new Mesh(batch.geometry, material)
  mesh.name = 'posters'
  mesh.userData.runtimeHelper = true
  mesh.matrixAutoUpdate = false
  const colors = batch.geometry.getAttribute('color') as BufferAttribute
  let lastMix = Number.NaN
  let lastHover: string | null = null
  const wallLight = baked ? lightMapOf(room.getObjectByName('static_room') ?? room) : null

  const tint = (index: number, value: [number, number, number]) => {
    const range = batch.vertices[index]
    if (!range) return
    for (let v = range.start; v < range.start + range.count; v++) colors.setXYZ(v, value[0], value[1], value[2])
    colors.needsUpdate = true
  }

  const bakedTint = (target: Target): [number, number, number] => {
    if (!target.uv1 || !wallLight) return [1, 1, 1]
    target.irrA ??= sampleTexture(wallLight, target.uv1)
    if (!target.irrB) {
      const off: Texture | null = lampOffBake('room')
      target.irrB = off ? sampleTexture(off, target.uv1) : null
    }
    const irrA = target.irrA
    if (!irrA) return [1, 1, 1]
    return [0, 1, 2].map((c) => mixedIrradiance(irrA[c] ?? 0, target.irrB?.[c] ?? null, LAMP_MIX.value) * IRR_SCALE) as [number, number, number]
  }

  return {
    mesh,
    draw() {
      const canvas = texture.image as HTMLCanvasElement
      const g = canvas.getContext('2d')
      if (!g) return () => undefined
      g.clearRect(0, 0, canvas.width, canvas.height)
      posters.forEach((poster, i) => {
        const rect = layout.rects[i]
        if (!rect) return
        g.save()
        g.translate(rect.x, rect.y)
        g.beginPath()
        g.rect(0, 0, rect.w, rect.h)
        g.clip()
        drawPoster(g, poster, rect.w, rect.h)
        g.restore()
      })
      texture.needsUpdate = true

      // The owner's images replace the generated art as they arrive.
      let cancelled = false
      const urls = overrideUrls(OVERRIDE_FILES, posters.map((poster) => poster.id))
      posters.forEach((poster, i) => {
        const url = urls.get(poster.id)
        const rect = layout.rects[i]
        if (!url || !rect) return
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
          if (cancelled) return
          g.save()
          g.translate(rect.x, rect.y)
          g.beginPath()
          g.rect(0, 0, rect.w, rect.h)
          g.clip()
          g.clearRect(0, 0, rect.w, rect.h)
          drawPosterImage(g, poster, image, rect.w, rect.h)
          g.restore()
          texture.needsUpdate = true
        }
        image.onerror = () => {
          if (import.meta.env.DEV) console.warn(`[posters] could not load ${url}; keeping the generated art`)
        }
        image.src = url
      })
      return () => {
        cancelled = true
      }
    },
    posterAt(faceIndex) {
      if (faceIndex === undefined || faceIndex === null) return null
      return posters[sourceOfFace(batch.ranges, faceIndex)] ?? null
    },
    update(hoveredId) {
      for (const node of hidden) node.visible = false
      const mix = LAMP_MIX.value
      if (mix === lastMix && hoveredId === lastHover) return
      lastMix = mix
      lastHover = hoveredId
      targets.forEach((target, i) => {
        const gain = hoveredId === target.poster.id ? HOVER_GAIN : 1
        const [r, g, b] = baked ? bakedTint(target) : [1, 1, 1]
        tint(i, [r * gain, g * gain, b * gain])
      })
    },
    dispose() {
      for (const node of hidden) node.visible = true
      batch.geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
