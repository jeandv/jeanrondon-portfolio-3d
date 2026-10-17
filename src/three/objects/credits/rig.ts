import { easing } from 'maath'
import {
  CanvasTexture,
  Euler,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import { CREDITS } from '../../../content/credits'
import { CARD_SIZE, drawCreditsCard } from '../../../screens/creditsCard'
import { useStore } from '../../../state/store'
import { CardPlacer, centredCardLayout } from '../../camera/workLayout'
import { createLitSurfaceMaterial } from '../../materials/litSurface'
import { nodeSpaceBounds } from '../bounds'
import { clampDt } from '../motion'

/** A 5 × 3 in index card (m). */
export const INDEX_CARD = { width: 0.127, height: 0.0762 } as const
const CARD_SMOOTH_TIME = 0.3
/** Filed away in the rolodex: at most this share of the rolodex's width. */
const FILED_WIDTH = 0.82
/** Without a rolodex the card rises from here (desk, in front of the lamp). */
const FALLBACK_REST = new Vector3(-0.62, 0.8, 0.02)
/** Closer than this (m) to its rest pose the card counts as filed (hidden). */
const FILED_EPSILON = 0.004

/** The card's canvas texture (three-native plane UVs: the default flipY stays on; mipmapped). */
function createCardTexture(canvas: HTMLCanvasElement): CanvasTexture {
  canvas.width = CARD_SIZE.width
  canvas.height = CARD_SIZE.height
  const texture = new CanvasTexture(canvas)
  texture.name = 'credits_card'
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  return texture
}

interface CardPose {
  readonly position: Vector3
  readonly quaternion: Quaternion
  readonly scale: number
}

/** Upright in the rolodex (its front facing out), sunk a little into the fan, at the rolodex's scale. */
function filedPose(room: Object3D): CardPose {
  const rolodex = room.getObjectByName('rolodex')
  if (!rolodex) return { position: FALLBACK_REST.clone(), quaternion: new Quaternion(), scale: 0.8 }
  const box = nodeSpaceBounds(rolodex)
  if (box.isEmpty()) return { position: rolodex.getWorldPosition(new Vector3()), quaternion: new Quaternion(), scale: 0.8 }
  const size = box.getSize(new Vector3())
  const scale = Math.min(1, (size.x * FILED_WIDTH) / INDEX_CARD.width)
  const local = new Vector3((box.min.x + box.max.x) / 2, box.max.y - (INDEX_CARD.height * scale) / 2, (box.min.z + box.max.z) / 2)
  rolodex.updateWorldMatrix(true, false)
  return {
    position: local.applyMatrix4(rolodex.matrixWorld),
    quaternion: rolodex.getWorldQuaternion(new Quaternion()),
    scale,
  }
}

/**
 * The credits index card: a canvas-drawn card (Courier Prime) that rises from
 * the rolodex to a camera-relative pose in the middle of the frame (CardPlacer,
 * like the #work notepad), damped with a slight sway, and files itself back.
 * Hidden while filed. Lives at the scene root (world = parent space).
 */
export class CreditsCardRig {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
  private readonly canvas = document.createElement('canvas')
  private readonly texture = createCardTexture(this.canvas)
  private readonly placer: CardPlacer
  private rest: CardPose = { position: FALLBACK_REST.clone(), quaternion: new Quaternion(), scale: 0.8 }
  private readonly target = new Vector3()
  private readonly targetQuat = new Quaternion()
  private readonly sway = new Quaternion()
  private readonly euler = new Euler()
  private readonly scaleTarget = new Vector3()

  constructor() {
    this.mesh = new Mesh(
      new PlaneGeometry(INDEX_CARD.width, INDEX_CARD.height),
      createLitSurfaceMaterial(this.texture, { name: 'M_credits_card', glow: 0.5, roughness: 0.9 }),
    )
    this.mesh.name = 'credits_card'
    this.mesh.userData = { runtimeHelper: true }
    this.mesh.visible = false
    this.placer = new CardPlacer(this.mesh, centredCardLayout)
    const raycast = this.mesh.raycast.bind(this.mesh)
    // Only the card that is up answers the pointer.
    this.mesh.raycast = (raycaster, intersects) => {
      if (this.mesh.visible && useStore.getState().creditsOpen) raycast(raycaster, intersects)
    }
  }

  /** Draws the card (fonts are loaded) and files it in the rolodex of `room`. */
  start(room: Object3D): void {
    const g = this.canvas.getContext('2d')
    if (g) drawCreditsCard(g, CREDITS)
    this.texture.needsUpdate = true
    this.rest = filedPose(room)
    this.snap(false)
  }

  frame(camera: Camera, aspect: number, time: number, dt: number): void {
    const { creditsOpen, reducedMotion } = useStore.getState()
    const up = creditsOpen && aspect > 0 && this.placer.place(camera, aspect)
    if (up) {
      this.target.copy(this.placer.position)
      this.targetQuat.copy(this.placer.quaternion)
      this.scaleTarget.setScalar(1)
      if (!reducedMotion) {
        this.euler.set(Math.sin(time * 0.8) * 0.018, Math.sin(time * 0.6) * 0.022, Math.sin(time * 1.1) * 0.008)
        this.targetQuat.multiply(this.sway.setFromEuler(this.euler))
      }
    } else {
      this.target.copy(this.rest.position)
      this.targetQuat.copy(this.rest.quaternion)
      this.scaleTarget.setScalar(this.rest.scale)
    }
    if (reducedMotion) {
      this.snap(up)
      return
    }
    const step = clampDt(dt)
    easing.damp3(this.mesh.position, this.target, CARD_SMOOTH_TIME, step)
    easing.dampQ(this.mesh.quaternion, this.targetQuat, CARD_SMOOTH_TIME, step)
    easing.damp3(this.mesh.scale, this.scaleTarget, CARD_SMOOTH_TIME, step)
    this.mesh.visible = up || this.mesh.position.distanceTo(this.rest.position) > FILED_EPSILON
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.texture.dispose()
  }

  private snap(up: boolean): void {
    this.mesh.position.copy(up ? this.target : this.rest.position)
    this.mesh.quaternion.copy(up ? this.targetQuat : this.rest.quaternion)
    this.mesh.scale.setScalar(up ? 1 : this.rest.scale)
    this.mesh.visible = up
  }
}
