import { Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  clampDt,
  FlapSpring,
  FLAP_SPRING,
  FloatRig,
  hingeOf,
  HingeTurn,
  MAX_DT,
  restPose,
  stepSpring,
} from './motion'

const FRAME = 1 / 60

describe('spring', () => {
  it('clamps dt to 1/20', () => {
    expect(clampDt(1)).toBe(MAX_DT)
    expect(clampDt(-1)).toBe(0)
    expect(clampDt(FRAME)).toBe(FRAME)
  })

  it('settles on x0 (k=120, c=12) within a second', () => {
    let state = { x: 1, v: 0 }
    let overshoot = 0
    for (let i = 0; i < 60; i++) {
      state = stepSpring(state, 0, FLAP_SPRING, FRAME)
      overshoot = Math.min(overshoot, state.x)
    }
    expect(Math.abs(state.x)).toBeLessThan(0.02)
    // Under-damped: it swings past the rest position a little.
    expect(overshoot).toBeLessThan(0)
  })

  it('stays stable with a huge frame step', () => {
    const state = stepSpring({ x: 1, v: 0 }, 0, FLAP_SPRING, 5)
    expect(Number.isFinite(state.x)).toBe(true)
    expect(Math.abs(state.x)).toBeLessThan(1)
  })
})

describe('VCR flap', () => {
  it('opens inward when kicked, never past closed, and springs shut', () => {
    const flap = new Object3D()
    const spring = new FlapSpring(flap)
    spring.kick()
    let maxAngle = 0
    for (let i = 0; i < 120; i++) {
      spring.update(FRAME)
      const angle = 2 * Math.atan2(flap.quaternion.x, flap.quaternion.w)
      expect(angle).toBeGreaterThanOrEqual(-1e-6)
      maxAngle = Math.max(maxAngle, angle)
    }
    expect(maxAngle).toBeGreaterThan(0.6)
    expect(maxAngle).toBeLessThan(1.5)
    expect(flap.quaternion.angleTo(new Quaternion())).toBeLessThan(0.01)
  })

  it('keeps its origin when the origin is the hinge', () => {
    const flap = new Object3D()
    flap.position.set(0.1, 0.8, 0.2)
    const spring = new FlapSpring(flap)
    spring.kick()
    for (let i = 0; i < 10; i++) spring.update(FRAME)
    expect(flap.position.toArray()).toEqual([0.1, 0.8, 0.2])
  })

  it('swings around userData.hinge when quantization moved the origin off the hinge', () => {
    // optimize-glb: origin moved to the mesh centre (hinge + R·o), uniform scale s, hinge kept as `hinge`.
    const hinge = new Vector3(-0.03, 0.816, 0.21)
    const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3)
    const offset = new Vector3(0, -0.016, 0.003)
    const scale = 0.1
    const flap = new Object3D()
    flap.position.copy(offset).applyQuaternion(rest).add(hinge)
    flap.quaternion.copy(rest)
    flap.scale.setScalar(scale)
    flap.userData.hinge = hinge.toArray()

    const spring = new FlapSpring(flap)
    spring.kick()
    // The hinge, in the node's quantized local space, is at −o/s; it must not move.
    const hingeLocal = offset.clone().multiplyScalar(-1 / scale)
    let opened = 0
    for (let i = 0; i < 40; i++) {
      spring.update(FRAME)
      flap.updateMatrix()
      opened = Math.max(opened, flap.quaternion.angleTo(rest))
      expect(hingeLocal.clone().applyMatrix4(flap.matrix).distanceTo(hinge)).toBeLessThan(1e-6)
    }
    expect(opened).toBeGreaterThan(0.6)
    spring.reset()
    expect(flap.position.distanceTo(offset.clone().applyQuaternion(rest).add(hinge))).toBeLessThan(1e-9)
  })

  it('turns a clock hand about its local Z around the dial centre, quantized or not', () => {
    // optimize-glb: the hand's origin moved to its mesh centre (12 o'clock side), scaled, `hinge` kept.
    const hinge = new Vector3(0, 0, 0.004)
    const offset = new Vector3(0, 0.03, 0)
    const scale = new Vector3(0.004, 0.04, 0.001)
    const hand = new Object3D()
    hand.position.copy(hinge).add(offset)
    hand.scale.copy(scale)
    hand.userData.hinge = hinge.toArray()
    const turn = new HingeTurn(hand, new Vector3(0, 0, 1))
    // A quarter turn clockwise seen from the front (−π/2 about +Z): the tip goes to 3 o'clock.
    turn.set(-Math.PI / 2)
    hand.updateMatrix()
    const tip = new Vector3(0, 0.5, 0).applyMatrix4(hand.matrix)
    expect(tip.x).toBeGreaterThan(0.03)
    expect(Math.abs(tip.y)).toBeLessThan(1e-9)
    // The dial centre (−offset/scale in the quantized local space) never moves.
    const centreLocal = new Vector3(-offset.x / scale.x, -offset.y / scale.y, -offset.z / scale.z)
    expect(centreLocal.applyMatrix4(hand.matrix).distanceTo(hinge)).toBeLessThan(1e-9)
    turn.set(0)
    expect(hand.position.distanceTo(hinge.clone().add(offset))).toBeLessThan(1e-12)
  })

  it('ignores a malformed hinge', () => {
    const flap = new Object3D()
    flap.position.set(1, 2, 3)
    flap.userData.hinge = [1, 'x', 3]
    expect(hingeOf(flap).toArray()).toEqual([1, 2, 3])
  })
})

describe('rest poses and movers', () => {
  it('captures the rest pose once', () => {
    const node = new Object3D()
    node.position.set(1, 2, 3)
    const first = restPose(node)
    node.position.set(9, 9, 9)
    expect(restPose(node).position.toArray()).toEqual(first.position.toArray())
  })

  it('floats the notepad to the anchor (in the parent space) and back', () => {
    const room = new Object3D()
    room.position.set(0, 0.1, 0)
    const notepad = new Object3D()
    notepad.position.set(0.7, 0.75, 0.17)
    const anchor = new Object3D()
    anchor.position.set(0.56, 1.06, 0.3)
    anchor.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
    room.add(notepad, anchor)
    room.updateMatrixWorld(true)

    const rig = new FloatRig(notepad, anchor)
    rig.update(true, 0, FRAME, true)
    expect(notepad.position.distanceTo(anchor.position)).toBeLessThan(1e-6)
    expect(notepad.quaternion.angleTo(anchor.quaternion)).toBeLessThan(1e-6)

    for (let i = 0; i < 240; i++) rig.update(false, i * FRAME, FRAME, false)
    expect(notepad.position.distanceTo(new Vector3(0.7, 0.75, 0.17))).toBeLessThan(1e-3)
  })
})
