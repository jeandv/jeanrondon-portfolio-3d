import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { FRAMES, positionFor } from '../../camera/frames'
import { boxOfNodes } from '../../camera/frames'
import { nodeSpaceBounds } from '../bounds'
import { AT_SLOT, OFF_SHELF, SEGMENTS } from './deck'
import { createTapePath, cubicBezier, easeInOutCubic, sampleTapePath, type TapePath } from './path'
import { buildTapeRig, slotFrame } from './rig'

/** Greybox-like layout: tape upright at the shelf, VCR slot to its left. */
function samplePath(): TapePath {
  const slotQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  return createTapePath({
    rest: { position: new Vector3(0.45, 0.86, -0.04), quaternion: new Quaternion() },
    out: new Vector3(0, 0, 1),
    pull: 0.114,
    approach: new Vector3(-0.03, 0.8, 0.34),
    inside: new Vector3(-0.03, 0.8, 0.15),
    slotQuaternion,
    up: new Vector3(0, 1, 0),
    forward: new Vector3(0, 0, 1),
    handleForward: 0.44,
    lift: 0.16,
  })
}

const position = new Vector3()
const quaternion = new Quaternion()

describe('tape path', () => {
  const path = samplePath()

  it('hits its endpoints: rest, pulled out, aligned at the slot, inside (hidden)', () => {
    expect(sampleTapePath(path, 0, position, quaternion)).toBe(true)
    expect(position.distanceTo(path.rest.position)).toBeLessThan(1e-9)
    expect(quaternion.angleTo(path.rest.quaternion)).toBeLessThan(1e-6)

    sampleTapePath(path, OFF_SHELF, position, quaternion)
    expect(position.distanceTo(path.pulled)).toBeLessThan(1e-9)
    expect(position.z).toBeCloseTo(-0.04 + 0.114)

    sampleTapePath(path, AT_SLOT, position, quaternion)
    expect(position.distanceTo(path.approach)).toBeLessThan(1e-9)
    expect(quaternion.angleTo(path.slotQuaternion)).toBeLessThan(1e-6)

    expect(sampleTapePath(path, SEGMENTS, position, quaternion)).toBe(false)
    expect(position.distanceTo(path.inside)).toBeLessThan(1e-9)
    // Out-of-range progress clamps.
    sampleTapePath(path, 99, position, quaternion)
    expect(position.distanceTo(path.inside)).toBeLessThan(1e-9)
  })

  it('progresses monotonically: continuous, slides straight out, pushes straight in', () => {
    let previous = new Vector3()
    sampleTapePath(path, 0, previous, quaternion)
    let lastPull = 0
    let lastPush = Number.POSITIVE_INFINITY
    for (let i = 1; i <= 300; i++) {
      const s = (i / 300) * SEGMENTS
      sampleTapePath(path, s, position, quaternion)
      // No jumps between neighbouring progress values.
      expect(position.distanceTo(previous)).toBeLessThan(0.03)
      if (s <= OFF_SHELF) {
        const out = position.z - path.rest.position.z
        expect(out).toBeGreaterThanOrEqual(lastPull - 1e-12)
        lastPull = out
      }
      if (s >= AT_SLOT) {
        const left = position.distanceTo(path.inside)
        expect(left).toBeLessThanOrEqual(lastPush + 1e-12)
        lastPush = left
      }
      previous = position.clone()
    }
  })

  it('eases the arc (easeInOutCubic) and builds a proper Bézier', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(1)).toBe(1)
    const a = new Vector3(0, 0, 0)
    const d = new Vector3(1, 0, 0)
    expect(cubicBezier(a, a, d, d, 0.5, new Vector3()).x).toBeCloseTo(0.5)
  })

  it('lifts and turns flat during the arc', () => {
    sampleTapePath(path, OFF_SHELF + 0.5, position, quaternion)
    expect(position.y).toBeGreaterThan(path.pulled.y + 0.05)
    const turned = quaternion.angleTo(path.rest.quaternion)
    expect(turned).toBeGreaterThan(0.2)
    expect(turned).toBeLessThan(Math.PI / 2)
  })
})

/* ------------------------------------------------------------------ */
/* Greybox clearance                                                    */
/* ------------------------------------------------------------------ */

const GLB_PATH = fileURLToPath(new URL('../../../assets/models/room.glb', import.meta.url))
let room: Object3D

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '')
  room = gltf.scene
  room.updateMatrixWorld(true)
})

/** Points spread through a node-space box, in world space. */
function boxPoints(box: Box3, matrix: Matrix4, steps = [4, 10, 7]): Vector3[] {
  const points: Vector3[] = []
  const size = box.getSize(new Vector3())
  for (let i = 0; i < (steps[0] ?? 2); i++)
    for (let j = 0; j < (steps[1] ?? 2); j++)
      for (let k = 0; k < (steps[2] ?? 2); k++) {
        const f = (n: number, of: number) => (of <= 1 ? 0.5 : n / (of - 1))
        points.push(
          new Vector3(
            box.min.x + size.x * f(i, steps[0] ?? 2),
            box.min.y + size.y * f(j, steps[1] ?? 2),
            box.min.z + size.z * f(k, steps[2] ?? 2),
          ).applyMatrix4(matrix),
        )
      }
  return points
}

describe('greybox insertion paths', () => {
  const home = FRAMES.home
  const viewer = positionFor(new Vector3(...home.target), home.dir, home.distance)

  it('never pass through the TV or the VCR body (any slot, whole path)', () => {
    const slot = slotFrame(room, viewer)
    expect(slot).not.toBeNull()
    if (!slot) return
    const tv = boxOfNodes(room, ['tv_body']).expandByScalar(-0.002)
    const vcr = boxOfNodes(room, ['vcr_body']).expandByScalar(-0.002)
    for (let n = 1; n <= 8; n++) {
      const node = room.getObjectByName(`tape_0${n}`)
      if (!node) throw new Error(`missing tape_0${n}`)
      const rig = buildTapeRig(`t${n}`, node, slot, viewer)
      const box = nodeSpaceBounds(node)
      for (let i = 0; i <= 120; i++) {
        const s = (i / 120) * SEGMENTS
        sampleTapePath(rig.path, s, position, quaternion)
        const matrix = new Matrix4().compose(position, quaternion, node.scale)
        for (const point of boxPoints(box, matrix)) {
          expect(tv.containsPoint(point), `tape_0${n} at s=${s.toFixed(3)} inside the TV`).toBe(false)
          // Only the push (aligned with the slot) goes into the VCR.
          if (s < AT_SLOT) expect(vcr.containsPoint(point), `tape_0${n} at s=${s.toFixed(3)} inside the VCR`).toBe(false)
        }
      }
    }
  })

  it('ends inside the VCR, lying flat with the spine (label) facing out', () => {
    const slot = slotFrame(room, viewer)
    if (!slot) throw new Error('no slot')
    expect(slot.forward.z).toBeGreaterThan(0.99)
    const node = room.getObjectByName('tape_01')
    if (!node) throw new Error('missing tape_01')
    const rig = buildTapeRig('t1', node, slot, viewer)
    sampleTapePath(rig.path, SEGMENTS, position, quaternion)
    const vcr = boxOfNodes(room, ['vcr_body'])
    const matrix = new Matrix4().compose(position, quaternion, node.scale)
    for (const point of boxPoints(nodeSpaceBounds(node), matrix, [2, 2, 2])) expect(vcr.containsPoint(point)).toBe(true)
    // Long side along the VCR's width, spine normal pointing out of its front.
    const spine = new Vector3(0, 0, 1).applyQuaternion(quaternion)
    expect(spine.dot(slot.forward)).toBeGreaterThan(0.99)
    const long = new Vector3(0, 1, 0).applyQuaternion(quaternion)
    expect(Math.abs(long.dot(slot.right))).toBeGreaterThan(0.99)
  })
})
