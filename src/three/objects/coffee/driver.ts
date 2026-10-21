import { easing } from 'maath'
import { Box3, Matrix4, Mesh, Quaternion, Uniform, Vector3, type Camera, type Object3D, type PlaneGeometry, type ShaderMaterial } from 'three'
import { sfx } from '../../../audio/sfx'
import { CAPTURE, CAPTURE_CITY_TIME } from '../../../capture/mode'
import { useStore } from '../../../state/store'
import { contractNodeOf } from '../../materials/baked'
import { advanceMotionTime } from '../../materials/rain'
import { createSteamGeometry, createSteamMaterial, setSteamAmount } from '../../materials/steam'
import { clampDt, restPose, type Pose } from '../motion'
import { coffeeLeft, fullCup, refillDue, sipPhase, steamAmount, type SipPhase } from './cup'

/** Lift toward the camera and up (m), and the tilt (rad) on the way up and at the lips. */
export const SIP_LIFT = { toward: 0.24, up: 0.14, tiltLift: 0.28, tiltHold: 0.62 } as const
const SIP_SMOOTH_TIME = 0.14
/** The liquid's height above the mug's floor on the last sip, as a share of full. */
const LAST_SIP_LEVEL = 0.18
/** The steam fades out while the mug is up (fast) and back in once it is down (slower), seconds. */
export const STEAM_FADE = { out: 0.08, in: 0.6 } as const

/** Steam strength after `dt` (pure): eases toward 0 while the mug is lifted, back toward 1 once it is down. */
export function stepSteamLift(current: number, lifted: boolean, dt: number): number {
  const target = lifted ? 0 : 1
  const tau = lifted ? STEAM_FADE.out : STEAM_FADE.in
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau))
  return Math.abs(next - target) < 1e-3 ? target : next
}

const UP = new Vector3(0, 1, 0)

/** Bounds of the mug's own mesh(es) in the mug's space (not the liquid, steam or proxies). */
export function mugBounds(mug: Object3D): Box3 {
  mug.updateWorldMatrix(true, true)
  const toLocal = new Matrix4().copy(mug.matrixWorld).invert()
  const box = new Box3()
  const part = new Box3()
  const matrix = new Matrix4()
  mug.traverse((child) => {
    if (!(child instanceof Mesh) || child.userData.hotspotProxy === true) return
    if (child !== mug && contractNodeOf(child) !== mug) return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    const bbox = child.geometry.boundingBox
    if (bbox) box.union(part.copy(bbox).applyMatrix4(matrix.multiplyMatrices(toLocal, child.matrixWorld)))
  })
  return box
}

/** Mug ↔ the lifted, camera-facing sip pose (damped), in the mug's parent space. */
class SipRig {
  private readonly node: Object3D
  private readonly rest: Pose
  private readonly world = new Matrix4()
  private readonly parentInverse = new Matrix4()
  private readonly parentQuat = new Quaternion()
  private readonly restWorld = new Vector3()
  private readonly toCamera = new Vector3()
  private readonly axis = new Vector3()
  private readonly tilt = new Quaternion()
  private readonly scale = new Vector3()
  private readonly scratch = new Vector3()
  private readonly target = new Vector3()
  private readonly targetQuat = new Quaternion()

  constructor(node: Object3D) {
    this.node = node
    this.rest = restPose(node)
  }

  /** `raise` 0 = on the desk, 1 = lifted toward the camera and tilted by `tilt` (rad). */
  update(raise: number, tilt: number, camera: Camera, dt: number): void {
    const parent = this.node.parent
    this.world.compose(this.rest.position, this.rest.quaternion, this.scale.set(1, 1, 1))
    this.parentInverse.identity()
    this.parentQuat.identity()
    if (parent) {
      parent.updateWorldMatrix(true, false)
      this.world.premultiply(parent.matrixWorld)
      this.parentInverse.copy(parent.matrixWorld).invert()
      parent.getWorldQuaternion(this.parentQuat)
    }
    this.world.decompose(this.restWorld, this.targetQuat, this.scale)

    camera.getWorldPosition(this.toCamera).sub(this.restWorld)
    this.toCamera.y = 0
    if (this.toCamera.lengthSq() < 1e-6) this.toCamera.set(0, 0, 1)
    this.toCamera.normalize()
    // Turning about up × toCamera tips the rim toward the drinker (the camera).
    this.axis.crossVectors(UP, this.toCamera).normalize()
    this.tilt.setFromAxisAngle(this.axis, tilt * raise)

    this.target
      .copy(this.restWorld)
      .addScaledVector(this.toCamera, SIP_LIFT.toward * raise)
      .addScaledVector(this.scratch.copy(UP), SIP_LIFT.up * raise)
      .applyMatrix4(this.parentInverse)
    this.targetQuat.premultiply(this.tilt).premultiply(this.parentQuat.invert())

    const step = clampDt(dt)
    easing.damp3(this.node.position, this.target, SIP_SMOOTH_TIME, step)
    easing.dampQ(this.node.quaternion, this.targetQuat, SIP_SMOOTH_TIME, step)
  }

  reset(): void {
    this.node.position.copy(this.rest.position)
    this.node.quaternion.copy(this.rest.quaternion)
  }
}

/** The coffee's top disc sinks inside the mug and disappears when the cup is empty. */
class LiquidLevel {
  private readonly node: Object3D
  private readonly rest: Pose
  private readonly floor: number

  constructor(node: Object3D, mug: Object3D) {
    this.node = node
    this.rest = restPose(node)
    const box = mugBounds(mug)
    const bottom = box.isEmpty() ? 0 : box.min.y
    // The inside floor: a little above the mug's outer bottom.
    this.floor = bottom + (this.rest.position.y - bottom) * 0.1
  }

  /** `left` 1 = full … 0 = empty (hidden). */
  set(left: number): void {
    this.node.visible = left > 0
    const level = LAST_SIP_LEVEL + (1 - LAST_SIP_LEVEL) * left
    this.node.position.copy(this.rest.position)
    this.node.position.y = this.floor + (this.rest.position.y - this.floor) * level
  }

  reset(): void {
    this.node.position.copy(this.rest.position)
    this.node.visible = true
  }
}

/**
 * Runs the mug every frame (see objects/Coffee.tsx): the sip animation from
 * the store's cup, the liquid level, the steam and the refill.
 */
export class CoffeeDriver {
  readonly steam: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly mug: Object3D
  private readonly rig: SipRig
  private readonly liquid: LiquidLevel | null
  private readonly rim: Vector3
  private readonly time = new Uniform(0)
  /** When the running sip was clicked (s, performance clock). */
  private sipStart = Number.NEGATIVE_INFINITY
  /** The sip the level / sound still owe (set on click, paid at the lips). */
  private pending = false
  /** Steam fade (1 = down on the desk, 0 = lifted). */
  private lift = 1

  static create(room: Object3D): CoffeeDriver | null {
    const mug = room.getObjectByName('coffee_mug')
    return mug ? new CoffeeDriver(mug, room.getObjectByName('coffee_liquid') ?? null) : null
  }

  private constructor(mug: Object3D, liquid: Object3D | null) {
    this.mug = mug
    this.rig = new SipRig(mug)
    this.liquid = liquid ? new LiquidLevel(liquid, mug) : null
    const box = mugBounds(mug)
    this.rim = box.isEmpty()
      ? new Vector3(0, 0.1, 0)
      : new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)
    this.steam = new Mesh(createSteamGeometry(), createSteamMaterial(this.time))
    this.steam.name = 'coffee_steam'
    this.steam.userData = { runtimeHelper: true }
  }

  /** Places the steam, syncs the level and listens for sips; returns the cleanup. */
  start(): () => void {
    this.mug.updateWorldMatrix(true, false)
    this.steam.position.copy(this.rim).applyMatrix4(this.mug.matrixWorld)
    this.pending = false
    this.liquid?.set(coffeeLeft(useStore.getState().cup.sips))
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.cup === previous.cup) return
      if (state.cup.sips > previous.cup.sips) {
        this.sipStart = performance.now() / 1000
        this.pending = true
      } else {
        // Refilled.
        this.pending = false
        this.liquid?.set(coffeeLeft(state.cup.sips))
      }
    })
    return () => {
      unsubscribe()
      this.rig.reset()
      this.liquid?.reset()
    }
  }

  frame(camera: Camera, delta: number): void {
    const store = useStore.getState()
    const now = Date.now()
    if (refillDue(store.cup, now)) store.refillCup(now)
    const cup = CAPTURE ? fullCup(0) : store.cup
    const snap = store.reducedMotion || CAPTURE
    const phase: SipPhase = snap ? 'idle' : sipPhase(performance.now() / 1000 - this.sipStart)

    // The sip lands at the lips (at once with reduced motion): level + sound.
    if (this.pending && (snap || phase !== 'lift')) {
      this.pending = false
      this.liquid?.set(coffeeLeft(cup.sips))
      sfx('sip')
    }

    if (snap) {
      this.rig.reset()
    } else {
      const raise = phase === 'lift' || phase === 'hold' ? 1 : 0
      this.rig.update(raise, phase === 'hold' ? SIP_LIFT.tiltHold : SIP_LIFT.tiltLift, camera, delta)
    }

    this.time.value = CAPTURE ? CAPTURE_CITY_TIME : advanceMotionTime(this.time.value, delta, store.reducedMotion)
    // The plume rides on the rim (it follows the mug up and back) and fades while the mug is up.
    this.lift = snap ? 1 : stepSteamLift(this.lift, phase !== 'idle', clampDt(delta))
    this.mug.updateWorldMatrix(true, false)
    this.steam.position.copy(this.rim).applyMatrix4(this.mug.matrixWorld)
    const amount = steamAmount(cup, CAPTURE ? 0 : now) * this.lift
    setSteamAmount(this.steam.material, amount)
    this.steam.visible = amount > 0.01
  }

  dispose(): void {
    this.steam.geometry.dispose()
    this.steam.material.dispose()
  }
}
