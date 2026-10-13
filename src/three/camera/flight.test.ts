import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ARC_LIFT, arcWaypoint, createFlight, easeInOutCubic, quadraticBezier, sampleFlight } from './flight'

describe('easeInOutCubic', () => {
  it('hits the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
  })

  it('clamps outside [0, 1]', () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
  })

  it('is symmetric and monotonic', () => {
    let previous = 0
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeInOutCubic(t)
      expect(value + easeInOutCubic(1 - t)).toBeCloseTo(1, 12)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('quadraticBezier', () => {
  const p0 = new Vector3(0, 1, 2)
  const w = new Vector3(1, 3, 0)
  const p1 = new Vector3(4, 1, -2)

  it('starts at p0 and ends at p1', () => {
    expect(quadraticBezier(p0, w, p1, 0, new Vector3()).toArray()).toEqual(p0.toArray())
    expect(quadraticBezier(p0, w, p1, 1, new Vector3()).toArray()).toEqual(p1.toArray())
  })

  it('weights the waypoint ¼ ½ ¼ at t = 0.5', () => {
    const expected = new Vector3().addScaledVector(p0, 0.25).addScaledVector(w, 0.5).addScaledVector(p1, 0.25)
    expect(quadraticBezier(p0, w, p1, 0.5, new Vector3()).distanceTo(expected)).toBeLessThan(1e-12)
  })
})

describe('arcWaypoint', () => {
  const fromPos = new Vector3(-0.2, 1.3, 1.7)
  const toPos = new Vector3(1.3, 1.1, 1.2)
  const fromTarget = new Vector3(0.04, 1.1, 0.02)
  const toTarget = new Vector3(1.3, 1.0, 0.2)
  const mid = new Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5)

  it('is the plain midpoint without an arc', () => {
    expect(arcWaypoint(fromPos, toPos, fromTarget, toTarget, 0).distanceTo(mid)).toBeLessThan(1e-12)
  })

  it('pushes outward from the targets by `arc` and lifts by 0.1', () => {
    const targetMid = new Vector3().addVectors(fromTarget, toTarget).multiplyScalar(0.5)
    const outward = mid.clone().sub(targetMid).normalize()
    const expected = mid.clone().addScaledVector(outward, 0.35).add(new Vector3(0, ARC_LIFT, 0))
    expect(arcWaypoint(fromPos, toPos, fromTarget, toTarget, 0.35).distanceTo(expected)).toBeLessThan(1e-12)
  })
})

describe('sampleFlight', () => {
  const from = { pos: new Vector3(0, 1, 2), target: new Vector3(0, 1, 0) }
  const to = { pos: new Vector3(1, 1.2, 1), target: new Vector3(1, 1, 0) }

  it('starts at the origin pose and arrives exactly at the destination', () => {
    const flight = createFlight(from.pos, from.target, to.pos, to.target, 1000, 0.35, 100)
    const pos = new Vector3()
    const target = new Vector3()

    expect(sampleFlight(flight, 100, pos, target)).toBe(false)
    expect(pos.distanceTo(from.pos)).toBeLessThan(1e-12)
    expect(target.distanceTo(from.target)).toBeLessThan(1e-12)

    expect(sampleFlight(flight, 1100, pos, target)).toBe(true)
    expect(pos.distanceTo(to.pos)).toBeLessThan(1e-12)
    expect(target.distanceTo(to.target)).toBeLessThan(1e-12)
  })

  it('cuts instantly with a zero duration (reduced motion)', () => {
    const flight = createFlight(from.pos, from.target, to.pos, to.target, 0, 0, 0)
    const pos = new Vector3()
    expect(sampleFlight(flight, 0, pos, new Vector3())).toBe(true)
    expect(pos.distanceTo(to.pos)).toBeLessThan(1e-12)
  })

  it('does not alias the caller vectors', () => {
    const start = from.pos.clone()
    const flight = createFlight(start, from.target, to.pos, to.target, 1000, 0, 0)
    start.set(9, 9, 9)
    expect(flight.fromPos.distanceTo(from.pos)).toBeLessThan(1e-12)
  })
})
