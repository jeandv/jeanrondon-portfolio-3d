import { easing } from 'maath'
import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three'

/** Longest frame step the springs and dampers integrate (plan: clamp dt to 1/20). */
export const MAX_DT = 1 / 20

export function clampDt(dt: number): number {
  return Math.min(Math.max(dt, 0), MAX_DT)
}

/* ------------------------------------------------------------------ */
/* Spring (VCR flap)                                                    */
/* ------------------------------------------------------------------ */

export interface SpringState {
  readonly x: number
  readonly v: number
}

export interface SpringParams {
  /** Stiffness. */
  readonly k: number
  /** Damping. */
  readonly c: number
}

/** Plan §5.6: k=120, c=12 (under-damped, settles in ~0.6 s). */
export const FLAP_SPRING: SpringParams = { k: 120, c: 12 }

/** Semi-implicit Euler: v += (−k(x−x₀) − c·v)·dt; x += v·dt. */
export function stepSpring(state: SpringState, x0: number, { k, c }: SpringParams, dt: number): SpringState {
  const step = clampDt(dt)
  const v = state.v + (-k * (state.x - x0) - c * state.v) * step
  return { x: state.x + v * step, v }
}

/* ------------------------------------------------------------------ */
/* Rest poses                                                           */
/* ------------------------------------------------------------------ */

export interface Pose {
  readonly position: Vector3
  readonly quaternion: Quaternion
}

/**
 * The node's pose as loaded from the GLB, captured once in userData so
 * remounts (StrictMode, HMR) never mistake an animated pose for the rest pose.
 */
export function restPose(node: Object3D): Pose {
  const stored: unknown = node.userData.restPose
  if (stored && typeof stored === 'object' && 'position' in stored && 'quaternion' in stored) {
    const { position, quaternion } = stored
    if (position instanceof Vector3 && quaternion instanceof Quaternion) return { position, quaternion }
  }
  const pose: Pose = { position: node.position.clone(), quaternion: node.quaternion.clone() }
  node.userData.restPose = pose
  return pose
}

/** World pose of `anchor` expressed in `node`'s parent space. */
export function poseInParentOf(node: Object3D, anchor: Object3D): Pose {
  node.parent?.updateWorldMatrix(true, false)
  anchor.updateWorldMatrix(true, false)
  const local = new Matrix4()
  if (node.parent) local.copy(node.parent.matrixWorld).invert()
  local.multiply(anchor.matrixWorld)
  const position = new Vector3()
  const quaternion = new Quaternion()
  local.decompose(position, quaternion, new Vector3())
  return { position, quaternion }
}

/* ------------------------------------------------------------------ */
/* Floating notepad                                                     */
/* ------------------------------------------------------------------ */

export const NOTEPAD_SMOOTH_TIME = 0.35

/**
 * Damps the notepad between its rest pose and a raised pose (the #work card,
 * passed per frame; `anchor_notepad_up` when none is given), with a slight
 * sway when up.
 */
export class FloatRig {
  private readonly node: Object3D
  private readonly rest: Pose
  private readonly up: Pose
  private readonly target = new Vector3()
  private readonly targetQuat = new Quaternion()
  private readonly sway = new Quaternion()
  private readonly euler = new Euler()

  constructor(node: Object3D, anchor: Object3D | undefined) {
    this.node = node
    this.rest = restPose(node)
    this.up = anchor ? poseInParentOf(node, anchor) : this.rest
  }

  update(raised: boolean, time: number, dt: number, snap: boolean, raisedPose?: Pose): void {
    const pose = raised ? (raisedPose ?? this.up) : this.rest
    this.target.copy(pose.position)
    this.targetQuat.copy(pose.quaternion)
    if (snap) {
      this.node.position.copy(this.target)
      this.node.quaternion.copy(this.targetQuat)
      return
    }
    if (raised) {
      this.target.y += Math.sin(time * 1.3) * 0.004
      this.euler.set(Math.sin(time * 0.9) * 0.02, Math.sin(time * 0.7) * 0.015, Math.sin(time * 1.1) * 0.01)
      this.targetQuat.multiply(this.sway.setFromEuler(this.euler))
    }
    const step = clampDt(dt)
    easing.damp3(this.node.position, this.target, NOTEPAD_SMOOTH_TIME, step)
    easing.dampQ(this.node.quaternion, this.targetQuat, NOTEPAD_SMOOTH_TIME, step)
  }

  /** Puts the notepad back on the desk (unmount). */
  reset(): void {
    this.node.position.copy(this.rest.position)
    this.node.quaternion.copy(this.rest.quaternion)
  }
}

/* ------------------------------------------------------------------ */
/* VCR flap                                                             */
/* ------------------------------------------------------------------ */

/** Angular kick (rad/s) when a tape goes in: opens ~55° and springs shut. */
export const FLAP_KICK = 20
/** Hard stop at the closed position, with a small bounce. */
const FLAP_BOUNCE = 0.25
const FLAP_MAX = 1.5
const X_AXIS = new Vector3(1, 0, 0)

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/**
 * The hinge in the node's parent space. Blender puts the flap's origin on the
 * hinge, but meshopt quantization (scripts/optimize-glb.mjs) moves a node's
 * origin to its mesh's bounds; that script records the authored origin as the
 * `hinge` extra (→ userData). Not `pivot`: three's GLTFLoader reserves that
 * extra for its own pivot containers. Without it, the node's origin is the hinge.
 */
export function hingeOf(node: Object3D, rest: Pose = restPose(node)): Vector3 {
  const hinge: unknown = node.userData.hinge
  return isVec3(hinge) ? new Vector3(...hinge) : rest.position.clone()
}

/**
 * Turns a node about its hinge (`hingeOf`) around one of its local axes:
 * angle 0 is the rest pose. Used by the VCR flap (X) and the clock hands (Z).
 */
export class HingeTurn {
  private readonly node: Object3D
  private readonly rest: Pose
  /** Rest position relative to the hinge (zero when the origin is the hinge). */
  private readonly arm: Vector3
  private readonly hinge: Vector3
  private readonly axis: Vector3
  private readonly turn = new Quaternion()
  private readonly swing = new Quaternion()

  constructor(node: Object3D, axis: Vector3) {
    this.node = node
    this.axis = axis.clone().normalize()
    this.rest = restPose(node)
    this.hinge = hingeOf(node, this.rest)
    this.arm = this.rest.position.clone().sub(this.hinge)
  }

  set(angle: number): void {
    this.node.quaternion.copy(this.rest.quaternion).multiply(this.turn.setFromAxisAngle(this.axis, angle))
    // Same turn, about the hinge: the swing (R·turn·R⁻¹) carries the origin around it.
    this.swing.copy(this.node.quaternion).multiply(this.turn.copy(this.rest.quaternion).invert())
    this.node.position.copy(this.arm).applyQuaternion(this.swing).add(this.hinge)
  }
}

/** VCR flap on a spring around its hinge (local X); the body stops it at 0. */
export class FlapSpring {
  private readonly hinge: HingeTurn
  private state: SpringState = { x: 0, v: 0 }

  constructor(node: Object3D) {
    this.hinge = new HingeTurn(node, X_AXIS)
  }

  kick(velocity = FLAP_KICK): void {
    this.state = { x: this.state.x, v: this.state.v + velocity }
  }

  update(dt: number): void {
    if (this.state.x === 0 && this.state.v === 0) return
    let { x, v } = stepSpring(this.state, 0, FLAP_SPRING, dt)
    if (x < 0) {
      x = 0
      v = Math.abs(v) * FLAP_BOUNCE
    }
    if (x > FLAP_MAX) {
      x = FLAP_MAX
      v = 0
    }
    if (Math.abs(x) < 1e-4 && Math.abs(v) < 1e-3) {
      x = 0
      v = 0
    }
    this.state = { x, v }
    this.apply()
  }

  reset(): void {
    this.state = { x: 0, v: 0 }
    this.apply()
  }

  private apply(): void {
    this.hinge.set(this.state.x)
  }
}
