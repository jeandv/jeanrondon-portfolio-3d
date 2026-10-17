import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Mesh, Object3D, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { boxOfNodes, fovForAspect, frameFor, WORK_GROUP, type ResolvedView } from './frames'
import {
  CardPlacer,
  CENTRED_CARD_MAX_WIDTH,
  centredCardLayout,
  localSize,
  PORTRAIT_MAX_ASPECT,
  workLayout,
} from './workLayout'

const GLB_PATH = fileURLToPath(new URL('../../assets/models/room.glb', import.meta.url))
/** 800×600, 1280×720, 1920×820, 21:9, square, tablet portrait, 390×844. */
const ASPECTS = [4 / 3, 16 / 9, 1920 / 820, 21 / 9, 1, 0.75, 390 / 844]

let room: Object3D

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  room = (await new GLTFLoader().parseAsync(buffer, '')).scene
  room.updateMatrixWorld(true)
})

function cameraAt(view: { position: Vector3; target: Vector3 }, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(fovForAspect(aspect), aspect, 0.02, 80)
  camera.position.copy(view.position)
  camera.lookAt(view.target)
  camera.updateMatrixWorld(true)
  return camera
}

/** NDC bounds of a world box's corners. */
function ndcBounds(box: Box3, camera: PerspectiveCamera): Box3 {
  const out = new Box3()
  const corner = new Vector3()
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    out.expandByPoint(corner.project(camera).setZ(0))
  }
  return out
}

/** NDC bounds of the notepad placed as the card for `camera`. */
function cardBounds(camera: PerspectiveCamera, aspect: number): Box3 {
  const notepad = room.getObjectByName('notepad')
  if (!notepad) throw new Error('missing notepad')
  const placer = new CardPlacer(notepad)
  expect(placer.place(camera, aspect)).toBe(true)
  const size = localSize(notepad) ?? new Vector3()
  const pose = new Object3D()
  pose.position.copy(placer.position)
  pose.quaternion.copy(placer.quaternion)
  pose.updateMatrixWorld(true)
  const out = new Box3()
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const corner = new Vector3((sx * size.x) / 2, (sy * size.y) / 2, 0).applyMatrix4(pose.matrixWorld)
    out.expandByPoint(corner.project(camera).setZ(0))
  }
  return out
}

function workPose(aspect: number): ResolvedView {
  return frameFor('work', room, { fov: fovForAspect(aspect), aspect })
}

describe('#work composition', () => {
  it('uses the portrait layout at or below 0.8', () => {
    expect(workLayout(0.8).portrait).toBe(true)
    expect(workLayout(0.81).portrait).toBe(false)
    expect(PORTRAIT_MAX_ASPECT).toBe(0.8)
  })

  it.each(ASPECTS)('aspect %f: TV group and card are fully visible and do not overlap', (aspect) => {
    const view = workPose(aspect)
    const camera = cameraAt(view, aspect)
    const group = ndcBounds(boxOfNodes(room, WORK_GROUP), camera)
    const card = cardBounds(camera, aspect)
    for (const bounds of [group, card]) {
      expect(bounds.min.x).toBeGreaterThan(-1)
      expect(bounds.max.x).toBeLessThan(1)
      expect(bounds.min.y).toBeGreaterThan(-1)
      expect(bounds.max.y).toBeLessThan(1)
    }
    if (aspect <= PORTRAIT_MAX_ASPECT) {
      // Card in the lower half, TV group above it.
      expect(card.max.y).toBeLessThan(group.min.y)
      expect(card.max.y).toBeLessThan(0.05)
    } else {
      // TV group on the left ~half, card on the right ~40%.
      expect(group.max.x).toBeLessThan(card.min.x)
      expect(group.max.x).toBeLessThan(0.15)
      expect(card.min.x).toBeGreaterThan(0)
      // A large card: at least half the frame height.
      expect(card.max.y - card.min.y).toBeGreaterThan(1)
    }
  })

  it.each([4 / 3, 16 / 9, 21 / 9, 390 / 844])('aspect %f: the TV group stays on screen across the orbit limits', (aspect) => {
    const view = workPose(aspect)
    const { limits, target } = view
    const offset = view.position.clone().sub(target)
    const box = boxOfNodes(room, WORK_GROUP)
    const centre = box.getCenter(new Vector3())
    for (const azimuth of [limits.minAzimuthAngle, limits.maxAzimuthAngle]) {
      for (const polar of [limits.minPolarAngle, limits.maxPolarAngle]) {
        for (const distance of [limits.minDistance, limits.maxDistance]) {
          const position = new Vector3().setFromSphericalCoords(distance, polar, azimuth).add(target)
          const camera = cameraAt({ position, target }, aspect)
          const ndc = centre.clone().project(camera)
          expect(Math.abs(ndc.x)).toBeLessThan(1)
          expect(Math.abs(ndc.y)).toBeLessThan(1)
        }
      }
    }
    expect(offset.length()).toBeGreaterThan(0)
  })
})

describe('credits card (centred layout)', () => {
  const INDEX_CARD_ASPECT = 0.127 / 0.0762

  it.each(ASPECTS)('aspect %f: a big card in the middle that never leaves the frame', (aspect) => {
    const layout = centredCardLayout(aspect, INDEX_CARD_ASPECT)
    const widthFrac = (INDEX_CARD_ASPECT * layout.heightFrac) / aspect
    expect(layout.ndcX).toBe(0)
    expect(widthFrac).toBeLessThanOrEqual(CENTRED_CARD_MAX_WIDTH + 1e-9)
    expect(layout.heightFrac).toBeLessThanOrEqual(0.62)
    // Wide frames: as tall as allowed; narrow ones (portrait): as wide as allowed.
    const wide = (CENTRED_CARD_MAX_WIDTH * aspect) / INDEX_CARD_ASPECT >= 0.62
    if (wide) expect(layout.heightFrac).toBe(0.62)
    else expect(widthFrac).toBeCloseTo(CENTRED_CARD_MAX_WIDTH)
    expect(wide).toBe(aspect > 1.15)
  })

  it('CardPlacer takes the layout: the card centre lands on the frame centre line', () => {
    const aspect = 16 / 9
    const camera = cameraAt(frameFor('home', room, { fov: fovForAspect(aspect), aspect }), aspect)
    const card = new Mesh(new PlaneGeometry(0.127, 0.0762))
    const placer = new CardPlacer(card, centredCardLayout)
    expect(placer.place(camera, aspect)).toBe(true)
    const ndc = placer.position.clone().project(camera)
    expect(ndc.x).toBeCloseTo(0, 5)
    expect(ndc.y).toBeGreaterThan(0)
    expect(ndc.z).toBeLessThan(1)
  })
})
