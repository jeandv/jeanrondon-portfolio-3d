import { Vector3 } from 'three'

/** Pure camera-flight math: easing, quadratic Bézier with an arc waypoint. */

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

/** B(t) = (1−t)²·p0 + 2(1−t)t·w + t²·p1, written into `out`. */
export function quadraticBezier(p0: Vector3, w: Vector3, p1: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t
  const a = u * u
  const b = 2 * u * t
  const c = t * t
  return out.set(
    a * p0.x + b * w.x + c * p1.x,
    a * p0.y + b * w.y + c * p1.y,
    a * p0.z + b * w.z + c * p1.z,
  )
}

const WORLD_UP = new Vector3(0, 1, 0)
/** Extra lift added to arced flights. */
export const ARC_LIFT = 0.1

/**
 * Waypoint W = mid + normalize(mid − targetMid)·arc + up·0.1, where `mid` is the
 * midpoint of the camera positions and `targetMid` the midpoint of the targets:
 * the camera swings outward (away from what it looks at) while travelling.
 * `arc ≤ 0` yields the plain midpoint (straight flight).
 */
export function arcWaypoint(
  fromPos: Vector3,
  toPos: Vector3,
  fromTarget: Vector3,
  toTarget: Vector3,
  arc: number,
  out = new Vector3(),
): Vector3 {
  out.addVectors(fromPos, toPos).multiplyScalar(0.5)
  if (arc <= 0) return out
  const targetMid = new Vector3().addVectors(fromTarget, toTarget).multiplyScalar(0.5)
  const outward = new Vector3().subVectors(out, targetMid)
  if (outward.lengthSq() < 1e-10) outward.copy(WORLD_UP)
  return out.addScaledVector(outward.normalize(), arc).addScaledVector(WORLD_UP, ARC_LIFT)
}

export interface Flight {
  readonly fromPos: Vector3
  readonly toPos: Vector3
  readonly fromTarget: Vector3
  readonly toTarget: Vector3
  readonly waypoint: Vector3
  readonly start: number
  readonly duration: number
}

export function createFlight(
  fromPos: Vector3,
  fromTarget: Vector3,
  toPos: Vector3,
  toTarget: Vector3,
  duration: number,
  arc: number,
  start: number,
): Flight {
  return {
    fromPos: fromPos.clone(),
    toPos: toPos.clone(),
    fromTarget: fromTarget.clone(),
    toTarget: toTarget.clone(),
    waypoint: arcWaypoint(fromPos, toPos, fromTarget, toTarget, arc),
    start,
    duration: Math.max(0, duration),
  }
}

/**
 * Samples a flight at time `now`: the position follows the Bézier, the target
 * lerps linearly, both with easeInOutCubic. Returns true once it has arrived.
 */
export function sampleFlight(flight: Flight, now: number, outPos: Vector3, outTarget: Vector3): boolean {
  const t = flight.duration === 0 ? 1 : Math.min(1, Math.max(0, (now - flight.start) / flight.duration))
  const e = easeInOutCubic(t)
  quadraticBezier(flight.fromPos, flight.waypoint, flight.toPos, e, outPos)
  outTarget.lerpVectors(flight.fromTarget, flight.toTarget, e)
  return t >= 1
}
