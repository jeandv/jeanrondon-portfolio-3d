import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Color, Matrix4, Mesh, PerspectiveCamera, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { boxOfNodes, fovForAspect, frameFor } from '../camera/frames'
import { CITY_FAR, CITY_NEAR, rooftops, yAt } from './cityLayer'
import {
  angleOnCylinder,
  CLEARING_SCALE,
  clearingFor,
  createObeliskGeometry,
  OBELISK,
  OBELISK_COLORS,
  OBELISK_LIGHT,
  OBELISK_PART,
  obeliskPose,
  obeliskSize,
} from './obelisk'

const GLB_PATH = fileURLToPath(new URL('../../assets/models/room.glb', import.meta.url))
/** Home view at 4:3, 16:9 and 21:9 (the obelisk must read in all three). */
const LANDSCAPES = [4 / 3, 16 / 9, 21 / 9]
const PHONE = 390 / 844

let room: Object3D
let city = new Vector3()
let opening = new Box3()

function node(name: string): Object3D {
  const object = room.getObjectByName(name)
  if (!object) throw new Error(`missing node ${name}`)
  return object
}

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  room = (await new GLTFLoader().parseAsync(buffer, '')).scene
  room.updateMatrixWorld(true)
  city = node('anchor_city').getWorldPosition(new Vector3())
  const glass = node('window_glass')
  if (!(glass instanceof Mesh)) throw new Error('window_glass is not a mesh')
  glass.geometry.computeBoundingBox()
  opening = new Box3().copy(glass.geometry.boundingBox ?? new Box3()).applyMatrix4(glass.matrixWorld)
})

function homeCamera(aspect: number): PerspectiveCamera {
  const fov = fovForAspect(aspect)
  const view = frameFor('home', room, { fov, aspect })
  const camera = new PerspectiveCamera(fov, aspect, 0.02, 80)
  camera.position.copy(view.position)
  camera.lookAt(view.target)
  camera.updateMatrixWorld(true)
  return camera
}

/** Screen position (0..1, y down) of a world point. */
function screen(camera: PerspectiveCamera, point: Vector3): { x: number; y: number } {
  const ndc = point.clone().project(camera)
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 }
}

interface Rect {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

function rectOf(camera: PerspectiveCamera, points: readonly Vector3[]): Rect {
  const projected = points.map((point) => screen(camera, point))
  return {
    x0: Math.min(...projected.map((p) => p.x)),
    x1: Math.max(...projected.map((p) => p.x)),
    y0: Math.min(...projected.map((p) => p.y)),
    y1: Math.max(...projected.map((p) => p.y)),
  }
}

function boxCorners(box: Box3): Vector3[] {
  return Array.from(
    { length: 8 },
    (_, i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
  )
}

/** Rects overlap (or come closer than `margin`). */
const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin

/** World corners of the shaft between heights y0 and y1 (world). */
function shaftCorners(camera: PerspectiveCamera, y0: number, y1: number): Vector3[] {
  const { position, yaw } = obeliskPose(city, camera.position)
  const { width, depth, baseY } = obeliskSize()
  const toWorld = new Matrix4().makeRotationY(yaw).setPosition(position)
  const corners: Vector3[] = []
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      for (const y of [y0, y1]) corners.push(new Vector3(x, y - baseY, z).applyMatrix4(toWorld))
    }
  }
  return corners
}

/** World height where the near skyline's tallest blocks stop covering the obelisk, as seen from the camera. */
function nearRoofline(camera: PerspectiveCamera): number {
  const { position } = obeliskPose(city, camera.position)
  const roofT = CITY_NEAR.ground + rooftops(CITY_NEAR).max
  const nearDistance = CITY_NEAR.radius + camera.position.distanceTo(city) * 0.9
  const elevation = (yAt(roofT, CITY_NEAR.radius) - camera.position.y) / nearDistance
  return camera.position.y + elevation * Math.hypot(position.x - camera.position.x, position.z - camera.position.z)
}

/** The right pane's clear opening in screen x at a given height: right of the right mullion, left of the right jamb. */
function rightPane(camera: PerspectiveCamera, y: number): { x0: number; x1: number } {
  const third = (opening.max.x - opening.min.x) / 3
  const mullion = opening.min.x + 2 * third + 0.02
  const jamb = opening.max.x - 0.05
  const z = (opening.min.z + opening.max.z) / 2
  return { x0: screen(camera, new Vector3(mullion, y, z)).x, x1: screen(camera, new Vector3(jamb, y, z)).x }
}

describe('Obelisco de Barquisimeto: shape and placement', () => {
  it('is a slender ~1:8 shaft with a narrower side face', () => {
    const { height, width, depth } = obeliskSize()
    expect(height).toBeGreaterThan(2)
    expect(width / height).toBeGreaterThan(1 / 9)
    expect(width / height).toBeLessThan(1 / 7)
    expect(depth).toBeLessThan(width)
  })

  it('stands between the near and far skylines (it parallaxes against both)', () => {
    expect(OBELISK.radius).toBeGreaterThan(CITY_NEAR.radius + 2)
    expect(OBELISK.radius).toBeLessThan(CITY_FAR.radius - 2)
    const { position } = obeliskPose(city, homeCamera(16 / 9).position)
    expect(Math.hypot(position.x - city.x, position.z - city.z)).toBeCloseTo(OBELISK.radius, 6)
  })

  it('builds one geometry: the shaft, the stair / wing and the plaza, inside its size', () => {
    const size = obeliskSize()
    const geometry = createObeliskGeometry(size)
    const parts = new Set(Array.from(geometry.getAttribute('aPart').array))
    expect([...parts].sort()).toEqual([OBELISK_PART.shaft, OBELISK_PART.base, OBELISK_PART.plaza])
    const box = geometry.boundingBox ?? new Box3()
    expect(box.max.y).toBeCloseTo(size.height, 6)
    expect(box.min.y).toBeGreaterThanOrEqual(0)
    expect(geometry.getAttribute('position').count / 3).toBeLessThan(200)
  })

  it('keeps the floodlit concrete under the bloom threshold and lets only the clock cross it', () => {
    // Brightest concrete: the base of the front face, right in the floodlights.
    const lit = new Color(OBELISK_COLORS.concrete).multiply(new Color(OBELISK_COLORS.uplight)).multiplyScalar(OBELISK_LIGHT.uplight)
    expect(lit.r * 0.2126 + lit.g * 0.7152 + lit.b * 0.0722).toBeLessThan(0.6)
    const face = new Color(OBELISK_COLORS.clockFace).multiplyScalar(OBELISK_LIGHT.clock)
    expect(face.r * 0.2126 + face.g * 0.7152 + face.b * 0.0722).toBeGreaterThan(0.88)
    expect(OBELISK_LIGHT.clock).toBeGreaterThan(0.88)
    expect(OBELISK_LIGHT.clock).toBeLessThan(2)
    expect(OBELISK_LIGHT.tiles).toBeLessThan(0.88)
  })
})

describe('Obelisco de Barquisimeto in the home view', () => {
  it.each(LANDSCAPES)('reads through the right pane at aspect %f: not behind a mullion, the jamb, the TV or the lamp', (aspect) => {
    const camera = homeCamera(aspect)
    const { baseY, height } = obeliskSize()
    const top = baseY + height
    const visibleFrom = Math.max(nearRoofline(camera), baseY)
    const shaft = rectOf(camera, shaftCorners(camera, visibleFrom, top))
    // Inside the frame.
    expect(shaft.x0).toBeGreaterThan(0.02)
    expect(shaft.x1).toBeLessThan(0.98)
    expect(shaft.y0).toBeGreaterThan(0.02)
    // Inside the right pane, clear of its mullion and jamb.
    for (const y of [visibleFrom, top]) {
      const pane = rightPane(camera, y)
      expect(shaft.x0).toBeGreaterThan(pane.x0 + 0.01)
      expect(shaft.x1).toBeLessThan(pane.x1 - 0.01)
    }
    // Clear of the TV and the lamp.
    for (const names of [['tv_body'], ['lamp_head', 'lamp_arm']]) {
      expect(overlaps(shaft, rectOf(camera, boxCorners(boxOfNodes(room, names))), 0.015)).toBe(false)
    }
  })

  it.each(LANDSCAPES)('tops out at 55–70%% of the visible window height at aspect %f', (aspect) => {
    const camera = homeCamera(aspect)
    const { baseY, height } = obeliskSize()
    const { position } = obeliskPose(city, camera.position)
    const topPoint = new Vector3(position.x, baseY + height, position.z)
    // The wall column the top is seen through.
    const ray = topPoint.clone().sub(camera.position)
    const k = (opening.max.z - camera.position.z) / ray.z
    const x = camera.position.x + ray.x * k
    const sill = screen(camera, new Vector3(x, opening.min.y, opening.max.z)).y
    const head = Math.max(0, screen(camera, new Vector3(x, opening.max.y, opening.max.z)).y)
    const fraction = (sill - screen(camera, topPoint).y) / (sill - head)
    expect(fraction).toBeGreaterThan(0.55)
    expect(fraction).toBeLessThan(0.7)
  })

  it('stands taller than the regular skyline around it (the far rooftops and the near blocks)', () => {
    const camera = homeCamera(16 / 9)
    const { position } = obeliskPose(city, camera.position)
    const { baseY, height } = obeliskSize()
    const distance = Math.hypot(position.x - camera.position.x, position.z - camera.position.z)
    const topElevation = (baseY + height - camera.position.y) / distance
    const farRoof = (yAt(CITY_FAR.ground + rooftops(CITY_FAR).max, CITY_FAR.radius) - camera.position.y) / (CITY_FAR.radius + 3)
    expect(topElevation).toBeGreaterThan(farRoof)
    expect(baseY + height).toBeGreaterThan(nearRoofline(camera) + height * 0.5)
  })

  it('also shows on a 390 × 844 phone, right of the mullion', () => {
    const camera = homeCamera(PHONE)
    const { baseY, height } = obeliskSize()
    const shaft = rectOf(camera, shaftCorners(camera, nearRoofline(camera), baseY + height))
    expect(shaft.x0).toBeGreaterThan(rightPane(camera, baseY + height).x0)
    expect(shaft.x1).toBeLessThan(0.97)
    expect(shaft.y0).toBeGreaterThan(0.02)
    expect(shaft.y1).toBeLessThan(0.98)
  })

  it('lowers the blocks around it on both skylines, centred on its direction', () => {
    const viewer = homeCamera(16 / 9).position
    const { position } = obeliskPose(city, viewer)
    for (const [layer, scale] of [
      [CITY_NEAR, CLEARING_SCALE.near],
      [CITY_FAR, CLEARING_SCALE.far],
    ] as const) {
      const clearing = clearingFor(layer, city, viewer, scale)
      expect(clearing.s).toBeCloseTo(angleOnCylinder(city, viewer, position, layer.radius), 3)
      expect(clearing.halfWidth).toBeGreaterThan(0.01)
      expect(clearing.halfWidth).toBeLessThan(0.12)
      expect(clearing.scale).toBeLessThan(1)
    }
  })
})
