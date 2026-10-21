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
import { ALL_CREDITS } from '../../../content/creditsExtra'
import { CARD_SIZE, COMPACT_CARD_SIZE, drawCreditsCard, drawCreditsCardCompact } from '../../../screens/creditsCard'
import { useStore } from '../../../state/store'
import { CardPlacer, centredCardLayout, compactCardLayout } from '../../camera/workLayout'
import { createLitSurfaceMaterial } from '../../materials/litSurface'
import { nodeSpaceBounds } from '../bounds'
import { clampDt } from '../motion'

/** A 5 × 3 in index card (m). */
export const INDEX_CARD = { width: 0.127, height: 0.0762 } as const
/** At most this wide (CSS px), the card is held upright with the large one-column print. */
export const COMPACT_MAX_WIDTH = 420
const CARD_SMOOTH_TIME = 0.3
/** Filed away in the rolodex: at most this share of the rolodex's width. */
const FILED_WIDTH = 0.82
/** Without a rolodex the card rises from here (desk, in front of the lamp). */
const FALLBACK_REST = new Vector3(-0.62, 0.8, 0.02)
/** Closer than this (m) to its rest pose the card counts as filed (hidden). */
const FILED_EPSILON = 0.004
/** The upright card files sideways (a quarter turn about its normal), like the wide one. */
const QUARTER_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)

/** The card's canvas texture (three-native plane UVs: the default flipY stays on; mipmapped). */
function createCardTexture(width: number, height: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
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

/** One print of the card: its plane, its texture and how it is held. */
interface CardFace {
  readonly geometry: PlaneGeometry
  readonly texture: CanvasTexture
  readonly placer: CardPlacer
  /** Draws the print (fonts are loaded). */
  readonly draw: (g: CanvasRenderingContext2D) => void
  /** Turn applied to the filed pose (the upright card files sideways). */
  readonly filedTurn: Quaternion | null
}

/**
 * The credits index card: a canvas-drawn card (Courier Prime) that rises from
 * the rolodex to a camera-relative pose in the middle of the frame (CardPlacer,
 * like the #work notepad), damped with a slight sway, and files itself back.
 * Hidden while filed. Lives at the scene root (world = parent space). On
 * narrow screens (≤ 420 px) it is held upright with a larger one-column print.
 */
export class CreditsCardRig {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
  private readonly wide: CardFace
  private readonly compact: CardFace
  private face: CardFace
  private filed: CardPose = { position: FALLBACK_REST.clone(), quaternion: new Quaternion(), scale: 0.8 }
  private rest: CardPose = this.filed
  private readonly target = new Vector3()
  private readonly targetQuat = new Quaternion()
  private readonly sway = new Quaternion()
  private readonly euler = new Euler()
  private readonly scaleTarget = new Vector3()

  constructor() {
    const wideGeometry = new PlaneGeometry(INDEX_CARD.width, INDEX_CARD.height)
    const wideTexture = createCardTexture(CARD_SIZE.width, CARD_SIZE.height)
    this.mesh = new Mesh(wideGeometry, createLitSurfaceMaterial(wideTexture, { name: 'M_credits_card', glow: 0.5, roughness: 0.9 }))
    this.mesh.name = 'credits_card'
    this.mesh.userData = { runtimeHelper: true }
    this.mesh.visible = false
    this.wide = {
      geometry: wideGeometry,
      texture: wideTexture,
      placer: new CardPlacer(this.mesh, centredCardLayout, new Vector3(INDEX_CARD.width, INDEX_CARD.height, 0)),
      draw: (g) => drawCreditsCard(g, ALL_CREDITS),
      filedTurn: null,
    }
    this.compact = {
      geometry: new PlaneGeometry(INDEX_CARD.height, INDEX_CARD.width),
      texture: createCardTexture(COMPACT_CARD_SIZE.width, COMPACT_CARD_SIZE.height),
      placer: new CardPlacer(this.mesh, compactCardLayout, new Vector3(INDEX_CARD.height, INDEX_CARD.width, 0)),
      draw: (g) => drawCreditsCardCompact(g, ALL_CREDITS),
      filedTurn: QUARTER_TURN,
    }
    this.face = this.wide
    const raycast = this.mesh.raycast.bind(this.mesh)
    // Only the card that is up answers the pointer.
    this.mesh.raycast = (raycaster, intersects) => {
      if (this.mesh.visible && useStore.getState().creditsOpen) raycast(raycaster, intersects)
    }
  }

  /** Draws both prints (fonts are loaded) and files the card in the rolodex of `room`. */
  start(room: Object3D): void {
    for (const face of [this.wide, this.compact]) {
      const canvas: unknown = face.texture.image
      const g = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null
      if (g) face.draw(g)
      face.texture.needsUpdate = true
    }
    this.filed = filedPose(room)
    this.useFace(this.face)
    this.snap(false)
  }

  /** `viewportWidth` (CSS px) picks the print: upright and larger on phones. */
  frame(camera: Camera, aspect: number, time: number, dt: number, viewportWidth = Number.POSITIVE_INFINITY): void {
    const face = viewportWidth <= COMPACT_MAX_WIDTH ? this.compact : this.wide
    if (face !== this.face) this.useFace(face)
    const { creditsOpen, reducedMotion } = useStore.getState()
    const up = creditsOpen && aspect > 0 && this.face.placer.place(camera, aspect)
    if (up) {
      this.target.copy(this.face.placer.position)
      this.targetQuat.copy(this.face.placer.quaternion)
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

  /** The print in use (`wide` or `compact`). */
  get print(): 'wide' | 'compact' {
    return this.face === this.compact ? 'compact' : 'wide'
  }

  dispose(): void {
    for (const face of [this.wide, this.compact]) {
      face.geometry.dispose()
      face.texture.dispose()
    }
    this.mesh.material.dispose()
  }

  private useFace(face: CardFace): void {
    this.face = face
    this.mesh.geometry = face.geometry
    this.mesh.material.map = face.texture
    this.mesh.material.emissiveMap = face.texture
    const quaternion = this.filed.quaternion.clone()
    if (face.filedTurn) quaternion.multiply(face.filedTurn)
    this.rest = { ...this.filed, quaternion }
  }

  private snap(up: boolean): void {
    this.mesh.position.copy(up ? this.target : this.rest.position)
    this.mesh.quaternion.copy(up ? this.targetQuat : this.rest.quaternion)
    this.mesh.scale.setScalar(up ? 1 : this.rest.scale)
    this.mesh.visible = up
  }
}
