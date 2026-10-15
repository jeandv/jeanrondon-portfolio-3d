import { Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { clampDt, FlapSpring, FLAP_SPRING, FloatRig, MAX_DT, restPose, stepSpring, TAPE_PULL, TapeSlider } from './motion'

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
})

describe('rest poses and movers', () => {
  it('captures the rest pose once', () => {
    const node = new Object3D()
    node.position.set(1, 2, 3)
    const first = restPose(node)
    node.position.set(9, 9, 9)
    expect(restPose(node).position.toArray()).toEqual(first.position.toArray())
  })

  it('slides the playing tape out along +Z and back', () => {
    const tape = new Object3D()
    tape.position.set(0.4, 0.8, -0.04)
    const slider = new TapeSlider(tape)
    slider.update(true, FRAME, true)
    expect(tape.position.z).toBeCloseTo(-0.04 + TAPE_PULL)
    for (let i = 0; i < 120; i++) slider.update(false, FRAME, false)
    expect(tape.position.z).toBeCloseTo(-0.04, 3)
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
