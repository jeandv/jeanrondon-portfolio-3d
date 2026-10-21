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
import { PROFILE } from '../../../content/profile'
import { drawCvCard, type CvCardContent } from '../../../screens/cvCard'
import { CV_SIZES, cvHits, type CvPrint } from '../../../screens/cvCardLayout'
import { hitTest, uvToCanvas, type HitRect, type Point } from '../../../screens/hit'
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

/** What the card prints: the owner (from the profile) and the credits behind the colophon. */
const CONTENT: CvCardContent = { name: PROFILE.name, role: PROFILE.role, credits: ALL_CREDITS }

/** The card's canvas texture (three-native plane UVs: the default flipY stays on; mipmapped). */
function createCardTexture(width: number, height: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const texture = new CanvasTexture(canvas)
  texture.name = 'cv_card'
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
  readonly print: CvPrint
  readonly geometry: PlaneGeometry
  readonly texture: CanvasTexture
  readonly placer: CardPlacer
  /** Turn applied to the filed pose (the upright card files sideways). */
  readonly filedTurn: Quaternion | null
  /** Whether the texture shows the OPEN CV button lit (null: not drawn yet). */
  painted: boolean | null
}

/**
 * The CV index card: a canvas-drawn card (Courier Prime) that rises from
 * the rolodex to a camera-relative pose in the middle of the frame (CardPlacer,
 * like the #work notepad), damped with a slight sway, and files itself back.
 * Hidden while filed. Lives at the scene root (world = parent space). On
 * narrow screens (≤ 420 px) it is held upright with a larger print. Its OPEN
 * CV button is a hit rect (`hitAt`) and lights up under the pointer.
 */
export class CvCardRig {
  readonly mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
  private readonly wide: CardFace
  private readonly compact: CardFace
  private face: CardFace
  private hover = false
  private filed: CardPose = { position: FALLBACK_REST.clone(), quaternion: new Quaternion(), scale: 0.8 }
  private rest: CardPose = this.filed
  private readonly target = new Vector3()
  private readonly targetQuat = new Quaternion()
  private readonly sway = new Quaternion()
  private readonly euler = new Euler()
  private readonly scaleTarget = new Vector3()

  constructor() {
    const wideGeometry = new PlaneGeometry(INDEX_CARD.width, INDEX_CARD.height)
    const wideTexture = createCardTexture(CV_SIZES.wide.width, CV_SIZES.wide.height)
    this.mesh = new Mesh(wideGeometry, createLitSurfaceMaterial(wideTexture, { name: 'M_cv_card', glow: 0.5, roughness: 0.9 }))
    this.mesh.name = 'cv_card'
    this.mesh.userData = { runtimeHelper: true }
    this.mesh.visible = false
    this.wide = {
      print: 'wide',
      geometry: wideGeometry,
      texture: wideTexture,
      placer: new CardPlacer(this.mesh, centredCardLayout, new Vector3(INDEX_CARD.width, INDEX_CARD.height, 0)),
      filedTurn: null,
      painted: null,
    }
    this.compact = {
      print: 'compact',
      geometry: new PlaneGeometry(INDEX_CARD.height, INDEX_CARD.width),
      texture: createCardTexture(CV_SIZES.compact.width, CV_SIZES.compact.height),
      placer: new CardPlacer(this.mesh, compactCardLayout, new Vector3(INDEX_CARD.height, INDEX_CARD.width, 0)),
      filedTurn: QUARTER_TURN,
      painted: null,
    }
    this.face = this.wide
    const raycast = this.mesh.raycast.bind(this.mesh)
    // Only the card that is up answers the pointer.
    this.mesh.raycast = (raycaster, intersects) => {
      if (this.mesh.visible && useStore.getState().cvOpen) raycast(raycaster, intersects)
    }
  }

  /** Draws both prints (fonts are loaded) and files the card in the rolodex of `room`. */
  start(room: Object3D): void {
    this.paint(this.wide)
    this.paint(this.compact)
    this.filed = filedPose(room)
    this.useFace(this.face)
    this.snap(false)
  }

  /** The hit rect under a pointer UV on the print in use (the OPEN CV button), or null. */
  hitAt(uv: Point): HitRect | null {
    const { width, height } = CV_SIZES[this.face.print]
    const point = uvToCanvas(uv, width, height, true)
    return hitTest(cvHits(this.face.print), point.x, point.y)
  }

  /** Lights the OPEN CV button (the texture is redrawn on the next frame). */
  setButtonHover(hover: boolean): void {
    this.hover = hover
  }

  /** `viewportWidth` (CSS px) picks the print: upright and larger on phones. */
  frame(camera: Camera, aspect: number, time: number, dt: number, viewportWidth = Number.POSITIVE_INFINITY): void {
    const face = viewportWidth <= COMPACT_MAX_WIDTH ? this.compact : this.wide
    if (face !== this.face) this.useFace(face)
    if (this.face.painted !== this.hover) this.paint(this.face)
    const { cvOpen, reducedMotion } = useStore.getState()
    const up = cvOpen && aspect > 0 && this.face.placer.place(camera, aspect)
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
  get print(): CvPrint {
    return this.face.print
  }

  dispose(): void {
    for (const face of [this.wide, this.compact]) {
      face.geometry.dispose()
      face.texture.dispose()
    }
    this.mesh.material.dispose()
  }

  /** (Re)draws a print with the button as it looks now. */
  private paint(face: CardFace): void {
    const canvas: unknown = face.texture.image
    const g = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null
    if (g) drawCvCard(g, CONTENT, face.print, this.hover)
    face.texture.needsUpdate = true
    face.painted = this.hover
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
