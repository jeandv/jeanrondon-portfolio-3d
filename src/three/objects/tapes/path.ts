import { MathUtils, Quaternion, Vector3 } from 'three'
import type { Pose } from '../motion'
import { AT_SLOT, OFF_SHELF, SEGMENTS } from './deck'

/**
 * Insertion path of one tape (pure; all vectors in the tape's parent space),
 * sampled by the deck progress s ∈ [0, 3]:
 *   pull  0→1  slides straight out of the rack along its spine normal
 *   arc   1→2  cubic Bézier (easeInOutCubic) up and forward, past the front of
 *              the TV, then back toward the slot; it turns to lie flat on the way
 *   push  2→3  straight into the slot; at 3 it is inside and hidden
 */

export interface TapePathInput {
  readonly rest: Pose
  /** Unit vector the tape slides out of the rack along (its spine normal). */
  readonly out: Vector3
  /** How far (m) it slides out (its depth plus a little). */
  readonly pull: number
  /** Tape centre in front of the slot, already aligned. */
  readonly approach: Vector3
  /** Tape centre fully inside the VCR. */
  readonly inside: Vector3
  /** Orientation in the slot (lying flat, spine facing out). */
  readonly slotQuaternion: Quaternion
  readonly up: Vector3
  /** Unit vector out of the VCR front. */
  readonly forward: Vector3
  /** Forward coordinate (·forward) both arc handles reach, so the tape clears the TV. */
  readonly handleForward: number
  /** Arc height (m) above the start. */
  readonly lift: number
}

export interface TapePath {
  readonly rest: Pose
  readonly pulled: Vector3
  readonly handleA: Vector3
  readonly handleB: Vector3
  readonly approach: Vector3
  readonly inside: Vector3
  readonly slotQuaternion: Quaternion
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/** Point on a cubic Bézier (written into `out`). */
export function cubicBezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t
  const wa = u * u * u
  const wb = 3 * u * u * t
  const wc = 3 * u * t * t
  const wd = t * t * t
  return out.set(
    a.x * wa + b.x * wb + c.x * wc + d.x * wd,
    a.y * wa + b.y * wb + c.y * wc + d.y * wd,
    a.z * wa + b.z * wb + c.z * wc + d.z * wd,
  )
}

/** Moves `point` along `forward` so that point·forward = target (in place). */
function toForward(point: Vector3, forward: Vector3, target: number): Vector3 {
  return point.addScaledVector(forward, target - point.dot(forward))
}

export function createTapePath(input: TapePathInput): TapePath {
  const pulled = input.rest.position.clone().addScaledVector(input.out, input.pull)
  const handleA = toForward(pulled.clone().addScaledVector(input.up, input.lift), input.forward, input.handleForward)
  const handleB = toForward(
    input.approach.clone().addScaledVector(input.up, input.lift * 0.55),
    input.forward,
    input.handleForward,
  )
  return {
    rest: input.rest,
    pulled,
    handleA,
    handleB,
    approach: input.approach.clone(),
    inside: input.inside.clone(),
    slotQuaternion: input.slotQuaternion.clone(),
  }
}

/** Share of the arc (eased) over which the tape turns to lie flat. */
const TURN_START = 0.2
const TURN_END = 0.8

/**
 * Pose at progress `s` (clamped to 0..3), written into `position` and
 * `quaternion`. Returns false when the tape is fully inside (hide it).
 */
export function sampleTapePath(path: TapePath, s: number, position: Vector3, quaternion: Quaternion): boolean {
  const p = MathUtils.clamp(s, 0, SEGMENTS)
  if (p <= OFF_SHELF) {
    position.lerpVectors(path.rest.position, path.pulled, easeInOutQuad(p))
    quaternion.copy(path.rest.quaternion)
    return true
  }
  if (p <= AT_SLOT) {
    const t = easeInOutCubic(p - OFF_SHELF)
    cubicBezier(path.pulled, path.handleA, path.handleB, path.approach, t, position)
    quaternion.slerpQuaternions(path.rest.quaternion, path.slotQuaternion, MathUtils.smoothstep(t, TURN_START, TURN_END))
    return true
  }
  position.lerpVectors(path.approach, path.inside, easeInOutQuad(p - AT_SLOT))
  quaternion.copy(path.slotQuaternion)
  return p < SEGMENTS
}
