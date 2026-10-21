import { Box3, Euler, MathUtils, Matrix4, Mesh, PerspectiveCamera, Quaternion, Vector3, type Camera, type Object3D } from 'three'

/**
 * #work composition (reference): the TV + VCR + tape rack on the left of the
 * frame and the notepad floating as a large card on the right, slightly
 * turned toward the camera. On portrait screens the card floats centred in
 * the lower half with the TV above it.
 *
 * The card pose is camera-relative (recomputed every frame from the live
 * camera), so it is fully visible at any aspect and while orbiting; the
 * camera itself is fitted to the TV group with the same layout (frames.ts).
 */

/** Below this aspect the portrait layout is used. */
export const PORTRAIT_MAX_ASPECT = 0.8
/** Greybox notepad width/height (0.16 × 0.26 m), used when the GLB has no notepad. */
export const NOTEPAD_ASPECT = 0.16 / 0.26

export interface GroupPlacement {
  /** NDC centre of the TV group on screen. */
  readonly ndcX: number
  readonly ndcY: number
  /** Max share of the frame width / height the group may cover. */
  readonly widthFrac: number
  readonly heightFrac: number
}

export interface CardPlacement {
  /** NDC centre of the card on screen. */
  readonly ndcX: number
  readonly ndcY: number
  /** Share of the frame height the card covers. */
  readonly heightFrac: number
  /** Turn toward the frame centre (rad, around the card's up axis). */
  readonly yaw: number
  /** Tilt (rad, around the card's right axis; negative = face tilted up). */
  readonly pitch: number
}

export interface WorkLayout {
  readonly portrait: boolean
  readonly group: GroupPlacement
  readonly card: CardPlacement
}

const toNdc = (fraction: number) => fraction * 2 - 1

/** Screen layout of the #work view for a viewport aspect (pure). */
export function workLayout(aspect: number, cardAspect = NOTEPAD_ASPECT): WorkLayout {
  if (aspect <= PORTRAIT_MAX_ASPECT) {
    return {
      portrait: true,
      group: { ndcX: 0, ndcY: 0.42, widthFrac: 0.86, heightFrac: 0.4 },
      card: { ndcX: 0, ndcY: -0.43, heightFrac: 0.38, yaw: 0, pitch: -0.16 },
    }
  }
  // Card on the right: as tall as fits, its right edge ≥ 4.5% from the frame edge.
  const heightFrac = Math.min(0.72, 0.62 * aspect)
  const cardWidth = (cardAspect * heightFrac) / aspect
  const cardCenter = Math.min(0.78, 0.955 - cardWidth / 2)
  // TV group centred in the space left of the card.
  const regionLeft = 0.04
  const regionRight = cardCenter - cardWidth / 2 - 0.04
  return {
    portrait: false,
    group: {
      ndcX: toNdc((regionLeft + regionRight) / 2),
      ndcY: 0.02,
      widthFrac: Math.min(0.5, regionRight - regionLeft),
      heightFrac: 0.7,
    },
    card: { ndcX: toNdc(cardCenter), ndcY: 0.02, heightFrac, yaw: -0.2, pitch: -0.05 },
  }
}

/** Where a floating card goes on screen for a viewport aspect and the card's width/height. */
export type CardLayout = (aspect: number, cardAspect: number) => CardPlacement

/** The #work notepad card (right of the TV, or below it on portrait). */
export const workCardLayout: CardLayout = (aspect, cardAspect) => workLayout(aspect, cardAspect).card

/** Most of the frame width the centred CV card may take. */
export const CENTRED_CARD_MAX_WIDTH = 0.9

/**
 * A card held up in the middle of the frame (the CV index card), a
 * touch above centre and tilted back: as tall as 62% of the frame, never
 * wider than 90% of it (portrait screens).
 */
export const centredCardLayout: CardLayout = (aspect, cardAspect) => ({
  ndcX: 0,
  ndcY: 0.06,
  heightFrac: Math.min(0.62, (CENTRED_CARD_MAX_WIDTH * aspect) / cardAspect),
  yaw: 0,
  pitch: -0.08,
})

/** Most of the frame width the upright (phone) CV card may take. */
export const COMPACT_CARD_MAX_WIDTH = 0.94

/**
 * The CV card on phones: held upright, as large as fits (up to 72% of
 * the frame height, 94% of its width), so its larger print reads.
 */
export const compactCardLayout: CardLayout = (aspect, cardAspect) => ({
  ndcX: 0,
  ndcY: 0.04,
  heightFrac: Math.min(0.72, (COMPACT_CARD_MAX_WIDTH * aspect) / cardAspect),
  yaw: 0,
  pitch: -0.06,
})

/** Most of the frame width the held calculator may take (portrait screens). */
export const HELD_MAX_WIDTH = 0.9

/**
 * The calculator held up in the middle of the frame, a touch low and tilted
 * back like a hand-held calculator: up to 70% of the frame height, never
 * wider than 90% of it.
 */
export const heldCalculatorLayout: CardLayout = (aspect, cardAspect) => ({
  ndcX: 0,
  ndcY: -0.02,
  heightFrac: Math.min(0.7, (HELD_MAX_WIDTH * aspect) / cardAspect),
  yaw: 0,
  pitch: -0.1,
})

/** Width/height of a node's own geometry (local space), or null without a mesh. */
export function localSize(node: Object3D): Vector3 | null {
  if (!(node instanceof Mesh)) return null
  const geometry = node.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox ?? new Box3()
  return box.isEmpty() ? null : box.getSize(new Vector3())
}

export interface CameraSpacePose {
  readonly position: Vector3
  readonly quaternion: Quaternion
}

/**
 * Card pose in camera space (camera looks down −Z): at the depth where a card
 * of `cardHeight` covers `heightFrac` of the frame, centred on (ndcX, ndcY),
 * facing the camera (+Z) then turned by yaw/pitch.
 */
export function cardCameraPose(fovDeg: number, aspect: number, cardHeight: number, card: CardPlacement): CameraSpacePose {
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2)
  const tanH = tanV * aspect
  const depth = cardHeight / (2 * tanV * card.heightFrac)
  return {
    position: new Vector3(card.ndcX * tanH * depth, card.ndcY * tanV * depth, -depth),
    quaternion: new Quaternion().setFromEuler(new Euler(card.pitch, card.yaw, 0, 'YXZ')),
  }
}

/**
 * Places a node as a camera-relative card for a live camera: the notepad as
 * the #work card (default layout), the CV card centred. Writes the
 * target pose in the node's parent space into `position` / `quaternion`.
 */
export class CardPlacer {
  private readonly node: Object3D
  private readonly size: Vector3
  private readonly layout: CardLayout
  private readonly world = new Matrix4()
  private readonly local = new Matrix4()
  private readonly scale = new Vector3()
  readonly position = new Vector3()
  readonly quaternion = new Quaternion()

  /** `size`: the card's width/height when the node has no mesh of its own (default: its geometry, else the notepad's). */
  constructor(node: Object3D, layout: CardLayout = workCardLayout, size?: Vector3) {
    this.node = node
    this.layout = layout
    this.size = size ?? localSize(node) ?? new Vector3(0.16, 0.26, 0.01)
  }

  get cardAspect(): number {
    return this.size.x / this.size.y
  }

  /** Updates `position`/`quaternion` (parent space) for `camera`; false if it is not a perspective camera. */
  place(camera: Camera, aspect: number): boolean {
    if (!(camera instanceof PerspectiveCamera)) return false
    camera.updateMatrixWorld()
    const pose = cardCameraPose(camera.fov, aspect, this.size.y, this.layout(aspect, this.cardAspect))
    this.world.compose(pose.position, pose.quaternion, this.scale.set(1, 1, 1)).premultiply(camera.matrixWorld)
    this.local.identity()
    if (this.node.parent) {
      this.node.parent.updateWorldMatrix(true, false)
      this.local.copy(this.node.parent.matrixWorld).invert()
    }
    this.local.multiply(this.world).decompose(this.position, this.quaternion, this.scale)
    return true
  }
}
