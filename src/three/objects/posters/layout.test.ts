import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Mesh, PerspectiveCamera, Raycaster, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { POSTERS, posterLabel, type Poster } from '../../../content/posters'
import { isCanvasSafe } from '../../../screens/text'
import { boxOfNodes, fovForAspect, frameFor, type ViewId } from '../../camera/frames'
import { buildPosterBatch, curledSource, curlOffset, CURL_SEGMENTS, sourceOfFace } from './batch'
import {
  packAtlas,
  POSTER_ATLAS,
  POSTER_ATLAS_PHONE,
  posterAtlas,
  posterQuad,
  rectsOverlap,
  rectUv,
  WALL_GAP,
  WALL_SLOTS,
  wallRect,
  type WallRect,
} from './layout'
import { overrideUrls } from './rig'

const GLB_PATH = fileURLToPath(new URL('../../../assets/models/room.glb', import.meta.url))

let room: Object3D
let opening = new Box3()
let roomBox = new Box3()

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  room = (await new GLTFLoader().parseAsync(buffer, '')).scene
  room.updateMatrixWorld(true)
  const glass = room.getObjectByName('window_glass')
  if (!(glass instanceof Mesh)) throw new Error('window_glass is not a mesh')
  glass.geometry.computeBoundingBox()
  opening = new Box3().copy(glass.geometry.boundingBox ?? new Box3()).applyMatrix4(glass.matrixWorld)
  roomBox = boxOfNodes(room, ['static_room'])
})

/** The window opening with its frame, jambs and sill, on the back wall. */
function windowRect(): WallRect {
  return { wall: 'back', a0: opening.min.x - 0.06, a1: opening.max.x + 0.06, y0: opening.min.y - 0.03, y1: opening.max.y + 0.06 }
}

function clockRect(): WallRect {
  const box = boxOfNodes(room, ['wall_clock'])
  return { wall: 'back', a0: box.min.x - 0.03, a1: box.max.x + 0.03, y0: box.min.y - 0.03, y1: box.max.y + 0.03 }
}

function corners(poster: Poster): Vector3[] {
  const quad = posterQuad(poster.slot, poster.size)
  const center = new Vector3(...quad.center)
  const right = new Vector3(...quad.right).multiplyScalar(quad.width / 2)
  const up = new Vector3(...quad.up).multiplyScalar(quad.height / 2)
  return [
    center.clone().sub(right).add(up),
    center.clone().add(right).add(up),
    center.clone().add(right).sub(up),
    center.clone().sub(right).sub(up),
  ]
}

function camera(view: ViewId, aspect: number): PerspectiveCamera {
  const fov = fovForAspect(aspect)
  const resolved = frameFor(view, room, { fov, aspect })
  const cam = new PerspectiveCamera(fov, aspect, 0.02, 80)
  cam.position.copy(resolved.position)
  cam.lookAt(resolved.target)
  cam.updateMatrixWorld(true)
  return cam
}

/** Share of the poster's area inside the frame (sampled on a grid), skipping samples hidden by the room's meshes. */
function visibleShare(poster: Poster, cam: PerspectiveCamera): number {
  const quad = posterQuad(poster.slot, poster.size)
  const center = new Vector3(...quad.center)
  const right = new Vector3(...quad.right)
  const up = new Vector3(...quad.up)
  const raycaster = new Raycaster()
  let seen = 0
  let total = 0
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      total++
      const point = center
        .clone()
        .addScaledVector(right, ((i + 0.5) / 6 - 0.5) * quad.width)
        .addScaledVector(up, ((j + 0.5) / 6 - 0.5) * quad.height)
      const ndc = point.clone().project(cam)
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) continue
      const dir = point.clone().sub(cam.position)
      const distance = dir.length()
      raycaster.set(cam.position, dir.normalize())
      raycaster.far = distance - 0.01
      if (raycaster.intersectObject(room, true).length === 0) seen++
    }
  }
  return seen / total
}

describe('poster content', () => {
  it('has three tech posters and five tributes with unique kebab-case ids and canvas-safe text', () => {
    expect(POSTERS.filter((poster) => poster.kind === 'tech')).toHaveLength(3)
    expect(POSTERS.filter((poster) => poster.kind === 'tribute')).toHaveLength(5)
    expect(new Set(POSTERS.map((poster) => poster.id)).size).toBe(POSTERS.length)
    for (const poster of POSTERS) {
      expect(poster.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(isCanvasSafe(posterLabel(poster)), poster.id).toBe(true)
      expect(Object.keys(WALL_SLOTS)).toContain(poster.slot)
    }
    expect(posterLabel(POSTERS.find((poster) => poster.id === 'berserk') ?? POSTERS[0]!)).toBe('BERSERK — KENTARO MIURA')
  })

  it('uses each wall slot once', () => {
    expect(new Set(POSTERS.map((poster) => poster.slot)).size).toBe(POSTERS.length)
  })
})

describe('poster layout on the greybox walls', () => {
  it('keeps every poster inside its wall, off the window, the clock and each other', () => {
    const rects = POSTERS.map((poster) => wallRect(poster.slot, poster.size))
    rects.forEach((rect, i) => {
      const id = POSTERS[i]?.id
      if (rect.wall === 'back') {
        expect(rect.a0, id).toBeGreaterThan(roomBox.min.x + 0.15)
        expect(rect.a1, id).toBeLessThan(roomBox.max.x - 0.15)
      } else {
        expect(rect.a0, id).toBeGreaterThan(-0.4 + 0.15)
        expect(rect.a1, id).toBeLessThan(roomBox.max.z)
      }
      expect(rect.y0, id).toBeGreaterThan(0.4)
      expect(rect.y1, id).toBeLessThan(roomBox.max.y - 0.3)
      expect(rectsOverlap(rect, windowRect()), id).toBe(false)
      expect(rectsOverlap(rect, clockRect()), id).toBe(false)
      rects.forEach((other, j) => {
        if (j > i) expect(rectsOverlap(rect, other, 0.04), `${id} / ${POSTERS[j]?.id}`).toBe(false)
      })
    })
  })

  it('hangs each sheet just in front of the wall it belongs to', () => {
    const raycaster = new Raycaster()
    for (const poster of POSTERS) {
      const quad = posterQuad(poster.slot, poster.size)
      const normal = new Vector3(...quad.normal)
      raycaster.set(new Vector3(...quad.center).addScaledVector(normal, 0.05), normal.clone().negate())
      raycaster.far = 0.2
      const hit = raycaster.intersectObject(room.getObjectByName('static_room') ?? room, true)[0]
      expect(hit, poster.id).toBeDefined()
      expect(hit?.distance ?? 0, poster.id).toBeCloseTo(0.05 + WALL_GAP, 3)
    }
  })

  it('keeps the banner under the sill between the desk top and the sill', () => {
    const banner = POSTERS.find((poster) => poster.slot === 'under-sill')
    if (!banner) throw new Error('no under-sill poster')
    const rect = wallRect(banner.slot, banner.size)
    expect(rect.y0).toBeGreaterThan(boxOfNodes(room, ['static_desk']).max.y)
    expect(rect.y1).toBeLessThan(opening.min.y - 0.015)
  })

  it.each([16 / 9, 21 / 9])('shows 2–3 posters in the home view at aspect %f, clear of the hint bar', (aspect) => {
    const cam = camera('home', aspect)
    const shown = POSTERS.filter((poster) => visibleShare(poster, cam) >= 0.5)
    expect(shown.length).toBeGreaterThanOrEqual(2)
    // The hint bar: bottom-left pill (1280 × 720: x 16…420 px, y 672…704 px).
    const height = 720
    const width = height * aspect
    for (const poster of shown) {
      const ys = corners(poster).map((point) => ((1 - point.clone().project(cam).y) / 2) * height)
      const xs = corners(poster).map((point) => ((point.clone().project(cam).x + 1) / 2) * width)
      const underBar = Math.max(...ys) > 672 && Math.min(...xs) < 420
      expect(underBar, poster.id).toBe(false)
    }
  })

  it('shows a poster in the #about view (under the clock)', () => {
    const shown = POSTERS.filter((poster) => visibleShare(poster, camera('pc', 16 / 9)) >= 0.5)
    expect(shown.map((poster) => poster.slot)).toContain('under-clock')
  })
})

describe('poster atlas', () => {
  it.each([
    ['desktop', POSTER_ATLAS, 700],
    ['phone', POSTER_ATLAS_PHONE, 350],
  ] as const)('packs every poster into the %s atlas, sharp enough, without overlaps', (_, atlas, minDensity) => {
    const layout = posterAtlas(POSTERS, atlas)
    expect(layout.density).toBeGreaterThanOrEqual(minDensity)
    expect(layout.rows).toBeGreaterThanOrEqual(1)
    layout.rects.forEach((rect, i) => {
      expect(rect.x).toBeGreaterThanOrEqual(atlas.pad)
      expect(rect.y).toBeGreaterThanOrEqual(atlas.pad)
      expect(rect.x + rect.w).toBeLessThanOrEqual(atlas.width - atlas.pad)
      expect(rect.y + rect.h).toBeLessThanOrEqual(atlas.height - atlas.pad)
      // Keeps the paper's aspect.
      const poster = POSTERS[i]
      if (poster) expect(rect.w / rect.h).toBeCloseTo(poster.size.width / poster.size.height, 1)
      layout.rects.forEach((other, j) => {
        if (j <= i) return
        const apart =
          rect.x + rect.w + atlas.pad <= other.x || other.x + other.w + atlas.pad <= rect.x || rect.y + rect.h + atlas.pad <= other.y || other.y + other.h + atlas.pad <= rect.y
        expect(apart).toBe(true)
      })
      const uv = rectUv(rect, atlas)
      expect(uv.u0).toBeGreaterThan(0)
      expect(uv.v1).toBeLessThan(1)
    })
  })

  it('throws when nothing fits', () => {
    expect(() => packAtlas([{ width: 10, height: 10 }], { width: 64, height: 64, pad: 2 })).toThrow()
  })
})

describe('poster geometry', () => {
  it('curls each sheet gently off the wall (never into it)', () => {
    const curl = { bulge: 0.006, lift: 0.012, peel: 1 }
    let max = 0
    for (let u = 0; u <= 1; u += 0.1) {
      for (let v = 0; v <= 1; v += 0.1) {
        const offset = curlOffset(u, v, curl)
        expect(offset).toBeGreaterThanOrEqual(0)
        max = Math.max(max, offset)
      }
    }
    expect(max).toBeLessThan(0.02)
    expect(curlOffset(0, 0, curl)).toBeCloseTo(0)
  })

  it('batches every poster into one geometry and maps a picked triangle back to its poster', () => {
    const uv = { u0: 0, u1: 1, v0: 0, v1: 1 }
    const sources = POSTERS.map((poster) => curledSource(posterQuad(poster.slot, poster.size), uv, { bulge: 0.004, lift: 0.006, peel: -1 }))
    const batch = buildPosterBatch(sources)
    const perSheet = CURL_SEGMENTS.x * CURL_SEGMENTS.y * 2
    expect(batch.geometry.index?.count).toBe(POSTERS.length * perSheet * 3)
    expect(sourceOfFace(batch.ranges, 0)).toBe(0)
    expect(sourceOfFace(batch.ranges, perSheet * 3 + 5)).toBe(3)
    expect(sourceOfFace(batch.ranges, POSTERS.length * perSheet)).toBe(-1)
    // Normals face the room.
    const normal = batch.geometry.getAttribute('normal')
    const first = POSTERS[0]
    if (!first) return
    const wallNormal = new Vector3(...posterQuad(first.slot, first.size).normal)
    expect(new Vector3(normal.getX(0), normal.getY(0), normal.getZ(0)).dot(wallNormal)).toBeGreaterThan(0.9)
  })
})

describe('owner images', () => {
  it('maps src/assets/posters/<id>.<ext> to known poster ids only', () => {
    const urls = overrideUrls(
      {
        '../../../assets/posters/berserk.jpg': '/a.jpg',
        '../../../assets/posters/berserk.png': '/b.png',
        '../../../assets/posters/unknown.webp': '/c.webp',
        '../../../assets/posters/joji.webp': '/d.webp',
      },
      POSTERS.map((poster) => poster.id),
    )
    expect([...urls.entries()]).toEqual([
      ['berserk', '/a.jpg'],
      ['joji', '/d.webp'],
    ])
  })
})
