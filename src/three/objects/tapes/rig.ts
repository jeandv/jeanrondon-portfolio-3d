import { Matrix4, Quaternion, Vector3, type Box3, type Object3D } from 'three'
import { boxOfNodes } from '../../camera/frames'
import { nodeSpaceBounds } from '../bounds'
import { restPose, type Pose } from '../motion'
import { createTapePath, type TapePath } from './path'

/**
 * Reads the shelf and the VCR from the GLB once and builds, per tape, its
 * insertion path and its spine label placement. Works from bounding boxes,
 * so it fits the greybox and a Blender export alike: a VHS box has a thin
 * axis (2.5 cm), a long one (18.7 cm) and the depth (10.2 cm); the spine is
 * the long × thin face that faces the room.
 */

const WORLD_UP = new Vector3(0, 1, 0)
/** Extra slide (m) past the tape's depth so it fully leaves the rack. */
const PULL_MARGIN = 0.012
/** Approach gap (m) between the tape and the slot. */
const APPROACH_GAP = 0.07
/** How far (m) past the flap the tape sits once inside. */
const INSIDE_DEPTH = 0.015
/** Clearance (m) in front of the TV / VCR fronts during the arc. */
const FRONT_CLEARANCE = 0.03
/** The arc's handles overshoot the clearance plane by this much (m). */
const HANDLE_OVERSHOOT = 0.07
const LIFT = 0.2
/** Label size relative to the spine face (length, height). */
export const LABEL_FILL = { length: 0.86, height: 0.7 } as const
/** Lift (m) of the auto decal off the spine. */
const DECAL_OFFSET = 0.0006

/** Local axis index (0 = x, 1 = y, 2 = z) with its sign. */
export interface SignedAxis {
  readonly index: 0 | 1 | 2
  readonly sign: 1 | -1
}

export function axisVector({ index, sign }: SignedAxis, out = new Vector3()): Vector3 {
  return out.set(index === 0 ? sign : 0, index === 1 ? sign : 0, index === 2 ? sign : 0)
}

export interface TapeShape {
  /** Box of the tape in node space. */
  readonly box: Box3
  /** Spine normal (points at the room) and text direction (along the long side), node space. */
  readonly normal: SignedAxis
  readonly text: SignedAxis
  readonly thinIndex: 0 | 1 | 2
  /** World sizes (m). */
  readonly long: number
  readonly thin: number
  readonly depth: number
}

/**
 * Classifies a tape's local box axes. `viewer` picks the spine side; the text
 * runs top → bottom on an upright tape (book-spine style), left → right on a
 * lying one, so it reads left → right once the tape lies in the VCR.
 */
export function tapeShape(box: Box3, matrixWorld: Matrix4, viewer: Vector3, right = new Vector3(1, 0, 0)): TapeShape {
  const size = box.getSize(new Vector3())
  const axes = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(matrixWorld, i))
  const world = [0, 1, 2].map((i) => size.getComponent(i) * (axes[i]?.length() ?? 1))
  const order = ([0, 1, 2] as const).slice().sort((a, b) => (world[a] ?? 0) - (world[b] ?? 0))
  const [thinIndex, depthIndex, longIndex] = order as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]
  const center = box.getCenter(new Vector3()).applyMatrix4(matrixWorld)

  const depthAxis = (axes[depthIndex] ?? new Vector3(0, 0, 1)).clone().normalize()
  const normalSign: 1 | -1 = depthAxis.dot(viewer.clone().sub(center)) >= 0 ? 1 : -1
  const longAxis = (axes[longIndex] ?? new Vector3(0, 1, 0)).clone().normalize()
  const upright = Math.abs(longAxis.dot(WORLD_UP)) > 0.5
  const textSign: 1 | -1 = upright ? (longAxis.dot(WORLD_UP) < 0 ? 1 : -1) : longAxis.dot(right) >= 0 ? 1 : -1
  return {
    box,
    normal: { index: depthIndex, sign: normalSign },
    text: { index: longIndex, sign: textSign },
    thinIndex,
    long: world[longIndex] ?? 0,
    thin: world[thinIndex] ?? 0,
    depth: world[depthIndex] ?? 0,
  }
}

/** Where the label sits on the spine (node space): centre, axes and size. */
export interface LabelPlacement {
  readonly center: Vector3
  /** Text direction (u). */
  readonly xAxis: Vector3
  /** Letters' up (v, toward the top of the glyphs). */
  readonly yAxis: Vector3
  readonly normal: Vector3
  /** Size in node units. */
  readonly width: number
  readonly height: number
  /** Physical width / height. */
  readonly aspect: number
}

export function labelPlacement(shape: TapeShape, scale: Vector3): LabelPlacement {
  const normal = axisVector(shape.normal)
  const xAxis = axisVector(shape.text)
  const yAxis = new Vector3().crossVectors(normal, xAxis)
  const size = shape.box.getSize(new Vector3())
  const normalScale = Math.abs(scale.getComponent(shape.normal.index)) || 1
  const center = shape.box
    .getCenter(new Vector3())
    .addScaledVector(normal, size.getComponent(shape.normal.index) / 2 + DECAL_OFFSET / normalScale)
  const width = size.getComponent(shape.text.index) * LABEL_FILL.length
  const height = size.getComponent(shape.thinIndex) * LABEL_FILL.height
  return {
    center,
    xAxis,
    yAxis,
    normal,
    width,
    height,
    aspect: (shape.long * LABEL_FILL.length) / Math.max(1e-6, shape.thin * LABEL_FILL.height),
  }
}

/** The VCR slot in world space. */
export interface SlotFrame {
  /** Flap centre (or the VCR front, ~55% up). */
  readonly mouth: Vector3
  readonly forward: Vector3
  readonly right: Vector3
  /** Forward coordinate of the VCR front (flap included). */
  readonly front: number
  /** Forward coordinate the arc must clear (TV and VCR fronts). */
  readonly clear: number
}

function maxAlong(box: Box3, direction: Vector3): number {
  const center = box.getCenter(new Vector3())
  const half = box.getSize(new Vector3()).multiplyScalar(0.5)
  return center.dot(direction) + Math.abs(half.x * direction.x) + Math.abs(half.y * direction.y) + Math.abs(half.z * direction.z)
}

/**
 * The VCR's front direction (horizontal): the thin axis of the flap plate,
 * pointing at the viewer; without a flap, the body's local +Z.
 */
function vcrForward(room: Object3D, viewer: Vector3): Vector3 {
  const flap = room.getObjectByName('vcr_flap')
  const body = room.getObjectByName('vcr_body')
  const forward = new Vector3(0, 0, 1)
  if (flap) {
    const box = nodeSpaceBounds(flap)
    if (!box.isEmpty()) {
      const size = box.getSize(new Vector3())
      const world = [0, 1, 2].map((i) => size.getComponent(i) * new Vector3().setFromMatrixColumn(flap.matrixWorld, i).length())
      const thin = world.indexOf(Math.min(...world))
      forward.setFromMatrixColumn(flap.matrixWorld, thin).normalize()
      const center = box.getCenter(new Vector3()).applyMatrix4(flap.matrixWorld)
      if (forward.dot(viewer.clone().sub(center)) < 0) forward.negate()
    }
  } else if (body) {
    forward.set(0, 0, 1).transformDirection(body.matrixWorld)
  }
  forward.setY(0)
  return forward.lengthSq() < 1e-8 ? new Vector3(0, 0, 1) : forward.normalize()
}

/** Null without a `vcr_body`. `viewer` (the home camera) tells the front from the back. */
export function slotFrame(room: Object3D, viewer: Vector3): SlotFrame | null {
  const body = boxOfNodes(room, ['vcr_body'])
  if (body.isEmpty()) return null
  const flap = boxOfNodes(room, ['vcr_flap'])
  const bodyCenter = body.getCenter(new Vector3())
  const mouth = flap.isEmpty()
    ? new Vector3(bodyCenter.x, body.min.y + (body.max.y - body.min.y) * 0.55, body.max.z)
    : flap.getCenter(new Vector3())
  const forward = vcrForward(room, viewer)
  const right = new Vector3().crossVectors(WORLD_UP, forward).normalize()
  const front = flap.isEmpty() ? maxAlong(body, forward) : Math.max(maxAlong(body, forward), maxAlong(flap, forward))
  const tv = boxOfNodes(room, ['tv_body'])
  const clear = Math.max(front, tv.isEmpty() ? front : maxAlong(tv, forward))
  return { mouth, forward, right, front, clear }
}

export interface TapeRig {
  readonly id: string
  readonly node: Object3D
  readonly path: TapePath
  readonly shape: TapeShape
  readonly label: LabelPlacement
}

const scratchQ = new Quaternion()

/** Rotation taking the basis (x, n×x, n) onto (x2, n2×x2, n2). */
function alignment(x: Vector3, n: Vector3, x2: Vector3, n2: Vector3): Quaternion {
  const from = new Matrix4().makeBasis(x, new Vector3().crossVectors(n, x), n)
  const to = new Matrix4().makeBasis(x2, new Vector3().crossVectors(n2, x2), n2)
  const qFrom = new Quaternion().setFromRotationMatrix(from)
  const qTo = new Quaternion().setFromRotationMatrix(to)
  return qTo.multiply(qFrom.invert())
}

/** Builds a tape's rig (path in its parent space) from its rest pose. */
export function buildTapeRig(id: string, node: Object3D, slot: SlotFrame, viewer: Vector3): TapeRig {
  const rest: Pose = restPose(node)
  node.parent?.updateWorldMatrix(true, false)
  const parentWorld = node.parent ? node.parent.matrixWorld.clone() : new Matrix4()
  const restWorld = parentWorld.clone().multiply(new Matrix4().compose(rest.position, rest.quaternion, node.scale))
  // Bounds are measured on the node as it is now; geometry is pose-independent.
  const box = nodeSpaceBounds(node)
  const shape = tapeShape(box, restWorld, viewer, slot.right)

  const normalWorld = axisVector(shape.normal).transformDirection(restWorld)
  const textWorld = axisVector(shape.text).transformDirection(restWorld)
  const restWorldQ = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(restWorld))
  const slotWorldQ = alignment(textWorld, normalWorld, slot.right, slot.forward).multiply(restWorldQ)

  const half = shape.depth / 2
  const base = slot.mouth
  const insideWorld = base.clone().addScaledVector(slot.forward, slot.front - half - INSIDE_DEPTH - base.dot(slot.forward))
  const approachWorld = base.clone().addScaledVector(slot.forward, slot.front + half + APPROACH_GAP - base.dot(slot.forward))
  const handleForwardWorld = Math.max(approachWorld.dot(slot.forward), slot.clear + half + FRONT_CLEARANCE) + HANDLE_OVERSHOOT

  // Everything into the tape's parent space.
  const toParent = parentWorld.clone().invert()
  const parentQInv = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(parentWorld)).invert()
  const toParentDir = (v: Vector3) => v.clone().applyQuaternion(parentQInv).normalize()
  const forward = toParentDir(slot.forward)
  const approach = approachWorld.clone().applyMatrix4(toParent)
  // Handle plane: the world plane mapped to parent space (a point on it, projected).
  const handlePoint = approachWorld.clone().addScaledVector(slot.forward, handleForwardWorld - approachWorld.dot(slot.forward))

  const path = createTapePath({
    rest,
    out: toParentDir(normalWorld),
    pull: shape.depth + PULL_MARGIN,
    approach,
    inside: insideWorld.applyMatrix4(toParent),
    slotQuaternion: scratchQ.copy(parentQInv).multiply(slotWorldQ).clone(),
    up: toParentDir(WORLD_UP),
    forward,
    handleForward: handlePoint.applyMatrix4(toParent).dot(forward),
    lift: LIFT,
  })
  return { id, node, path, shape, label: labelPlacement(shape, node.scale) }
}
