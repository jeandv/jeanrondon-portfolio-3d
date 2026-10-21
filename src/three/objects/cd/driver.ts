import { Vector3, type CanvasTexture, type Material, type Mesh, type Object3D } from 'three'
import type { DiscInfo } from '../../../audio/music/discs'
import { CAPTURE } from '../../../capture/mode'
import { useStore } from '../../../state/store'
import { createLitSurfaceMaterial } from '../../materials/litSurface'
import { meshOf } from '../bounds'
import { clampDt, HingeTurn, stepSpring, type SpringParams, type SpringState } from '../motion'
import { swapMaterial } from '../screenRuntime'
import { createDiscLabelTexture, redrawDiscLabel } from './discLabel'

/**
 * The CD player's moving parts: the lid on a spring around its back hinge
 * (`cd_lid`, local X; opens ~106°, a small bounce when it shuts) and the disc
 * (`cd_disc`, local Y) spinning up and down with the play state. Reduced
 * motion: the lid snaps and the disc stays still. ?capture: closed, still.
 */

/** Open angle (rad) of the lid. */
export const LID_OPEN = 1.85
export const LID_SPRING: SpringParams = { k: 110, c: 14 }
/** Bounce off the body when it shuts. */
const LID_BOUNCE = 0.2
/** Disc speed while playing (rad/s; slow enough to read, not a blur) and its spin-up / spin-down time constants (s). */
export const SPIN = { speed: 9, up: 0.45, down: 1.3 } as const

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)

/** Disc speed after `dt` (pure): eases toward the target with the spin-up or spin-down time constant. */
export function stepSpin(speed: number, target: number, dt: number): number {
  const tau = target > speed ? SPIN.up : SPIN.down
  const next = speed + (target - speed) * (1 - Math.exp(-Math.max(0, dt) / tau))
  return Math.abs(next - target) < 1e-3 ? target : next
}

/** The lid spring toward `target` (pure): stops at the body (bounces) and at a little past open. */
export function stepLid(state: SpringState, target: number, dt: number): SpringState {
  let { x, v } = stepSpring(state, target, LID_SPRING, dt)
  if (x < 0) {
    x = 0
    v = Math.abs(v) * LID_BOUNCE
  }
  if (x > LID_OPEN + 0.12) {
    x = LID_OPEN + 0.12
    v = 0
  }
  if (Math.abs(x - target) < 1e-4 && Math.abs(v) < 1e-3) return { x: target, v: 0 }
  return { x, v }
}

export class CdDriver {
  private readonly lid: HingeTurn | null
  private readonly disc: HingeTurn | null
  private readonly discMesh: Mesh | null
  private label: CanvasTexture | null = null
  private lidState: SpringState = { x: 0, v: 0 }
  private spin = 0
  private angle = 0

  static create(room: Object3D): CdDriver | null {
    if (!room.getObjectByName('cd_player')) return null
    const lid = room.getObjectByName('cd_lid')
    const disc = room.getObjectByName('cd_disc')
    return new CdDriver(lid ? new HingeTurn(lid, X_AXIS) : null, disc ? new HingeTurn(disc, Y_AXIS) : null, meshOf(disc))
  }

  private constructor(lid: HingeTurn | null, disc: HingeTurn | null, discMesh: Mesh | null) {
    this.lid = lid
    this.disc = disc
    this.discMesh = discMesh
  }

  /** Prints the label of `disc` (fonts are in); returns the cleanup. */
  start(disc: DiscInfo): () => void {
    let restore: (() => void) | null = null
    let material: Material | null = null
    const texture = this.discMesh ? createDiscLabelTexture(disc) : null
    this.label = texture
    if (this.discMesh && texture) {
      material = createLitSurfaceMaterial(texture, { name: 'M_cd_disc', glow: 0.3, roughness: 0.3 })
      restore = swapMaterial(this.discMesh, material)
    }
    return () => {
      restore?.()
      material?.dispose()
      texture?.dispose()
      this.label = null
      this.lidState = { x: 0, v: 0 }
      this.spin = 0
      this.lid?.set(0)
      this.disc?.set(0)
    }
  }

  /** DISC: the other disc's label. */
  setDisc(disc: DiscInfo): void {
    if (this.label) redrawDiscLabel(this.label, disc)
  }

  frame(delta: number): void {
    const { cd, disc, yt, reducedMotion } = useStore.getState()
    const open = !CAPTURE && cd.lid === 'open'
    // The disc in the player spins with whichever source plays it.
    const playing = !CAPTURE && (disc === 'joji' ? yt.status === 'playing' : cd.status === 'playing')
    const target = open ? LID_OPEN : 0
    const dt = clampDt(delta)
    if (reducedMotion || CAPTURE) {
      this.lidState = { x: target, v: 0 }
      this.spin = 0
    } else {
      if (this.lidState.x !== target || this.lidState.v !== 0) this.lidState = stepLid(this.lidState, target, dt)
      this.spin = stepSpin(this.spin, playing ? SPIN.speed : 0, dt)
      // Clockwise seen from the label side.
      this.angle = (this.angle + this.spin * dt) % (Math.PI * 2)
    }
    // Opening lifts the front edge: a negative turn about local X.
    this.lid?.set(-this.lidState.x)
    this.disc?.set(-this.angle)
  }
}
