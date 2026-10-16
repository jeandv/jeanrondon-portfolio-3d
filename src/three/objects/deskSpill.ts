import { Matrix4, Mesh, Quaternion, Raycaster, Vector3, type Object3D } from 'three'
import { boxOfNodes } from '../camera/frames'

/**
 * Where the TV's light lands on the desk: the strip of desk top in front of
 * the TV/VCR, found by raycasting down onto `static_desk` (so it stops at the
 * desk's front edge and sides instead of floating in the air).
 */

export interface SpillCard {
  /** Card centre, a hair above the desk top. */
  readonly center: Vector3
  /** Lies flat: local +X = right, +Y = toward the TV, +Z = up. */
  readonly quaternion: Quaternion
  readonly width: number
  /** From the TV/VCR front to the desk edge. */
  readonly depth: number
}

const UP = new Vector3(0, 1, 0)
const DOWN = new Vector3(0, -1, 0)
const STEP = 0.01
const MAX_DEPTH = 0.6
const MAX_HALF_WIDTH = 0.6
/** Card height above the desk (m); polygonOffset does the rest. */
const LIFT = 0.0015

function maxAlong(root: Object3D, names: readonly string[], direction: Vector3): number {
  const box = boxOfNodes(root, names)
  if (box.isEmpty()) return Number.NEGATIVE_INFINITY
  const center = box.getCenter(new Vector3())
  const half = box.getSize(new Vector3()).multiplyScalar(0.5)
  return center.dot(direction) + Math.abs(half.x * direction.x) + Math.abs(half.y * direction.y) + Math.abs(half.z * direction.z)
}

/** Null without a desk under the screen. */
export function deskSpillCard(room: Object3D, screen: Mesh): SpillCard | null {
  const desk = room.getObjectByName('static_desk')
  if (!desk) return null
  room.updateMatrixWorld(true)
  const origin = screen.getWorldPosition(new Vector3())
  const normal = new Vector3(0, 0, 1).transformDirection(screen.matrixWorld).setY(0)
  if (normal.lengthSq() < 1e-6) return null
  normal.normalize()
  const right = new Vector3().crossVectors(UP, normal).normalize()

  const front = Math.max(maxAlong(room, ['tv_body', 'vcr_body', 'vcr_flap'], normal), origin.dot(normal))
  const start = front - origin.dot(normal) + 0.004
  const raycaster = new Raycaster()
  const top = origin.y + 0.05
  const deskAt = (forward: number, side: number): number | null => {
    const from = origin.clone().addScaledVector(normal, forward).addScaledVector(right, side).setY(top)
    raycaster.set(from, DOWN)
    const hit = raycaster.intersectObject(desk, true)[0]
    return hit ? hit.point.y : null
  }

  const deskY = deskAt(start + STEP, 0)
  if (deskY === null) return null
  const sameTop = (y: number | null) => y !== null && Math.abs(y - deskY) < 0.01
  let end = start + STEP
  while (end + STEP <= start + MAX_DEPTH && sameTop(deskAt(end + STEP, 0))) end += STEP
  const depth = Math.max(0.04, end - start)
  const middle = start + depth / 2
  let left = 0
  while (left + 0.02 <= MAX_HALF_WIDTH && sameTop(deskAt(middle, -(left + 0.02)))) left += 0.02
  let rightReach = 0
  while (rightReach + 0.02 <= MAX_HALF_WIDTH && sameTop(deskAt(middle, rightReach + 0.02))) rightReach += 0.02
  const half = Math.max(0.1, Math.min(left, rightReach))

  const center = origin.clone().addScaledVector(normal, middle).setY(deskY + LIFT)
  const basis = new Matrix4().makeBasis(right, normal.clone().negate(), UP)
  return { center, quaternion: new Quaternion().setFromRotationMatrix(basis), width: half * 2, depth }
}
