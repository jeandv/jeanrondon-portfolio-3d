import { Box3, MathUtils, Mesh, Vector3, type Object3D } from 'three'
import type { Page } from '../../state/router'
import { localSize, workLayout } from './workLayout'

export type Vec3 = readonly [number, number, number]

/* ------------------------------------------------------------------ */
/* Field of view                                                        */
/* ------------------------------------------------------------------ */

export const BASE_FOV = 32
const TAN_HALF_BASE = Math.tan(MathUtils.degToRad(BASE_FOV / 2))

/**
 * Vertical FOV (degrees) for a viewport aspect, from the reference:
 * 2·atan(max(tan16°, min(.62, .29/aspect))). Landscape keeps 32° vertical;
 * portrait widens the vertical FOV so the horizontal framing survives.
 */
export function fovForAspect(aspect: number): number {
  const tanHalf = Math.max(TAN_HALF_BASE, Math.min(0.62, 0.29 / aspect))
  return MathUtils.radToDeg(2 * Math.atan(tanHalf))
}

/**
 * Distance that fits a box of size `maxDim` on screen:
 * (maxDim/2) / tan(fov/2) · fit. Uses the narrower of the vertical and
 * horizontal half-angles, so on portrait screens the subject is not cropped
 * (identical to the vertical formula whenever aspect ≥ 1).
 */
export function fitDistance(maxDim: number, fovDeg: number, aspect: number, fit: number): number {
  const tanVertical = Math.tan(MathUtils.degToRad(fovDeg) / 2)
  const tanHalf = Math.min(tanVertical, tanVertical * aspect)
  return (maxDim / 2 / tanHalf) * fit
}

/* ------------------------------------------------------------------ */
/* Orbit limits                                                         */
/* ------------------------------------------------------------------ */

export interface OrbitLimits {
  readonly minDistance: number
  readonly maxDistance: number
  readonly minPolarAngle: number
  readonly maxPolarAngle: number
  readonly minAzimuthAngle: number
  readonly maxAzimuthAngle: number
}

/** OrbitControls limits from the reference (azimuth/polar are absolute angles around the target). */
export const GLOBAL_LIMITS: OrbitLimits = {
  minDistance: 0.3,
  maxDistance: 2.6,
  minPolarAngle: 0.95,
  maxPolarAngle: 1.72,
  minAzimuthAngle: -1.3,
  maxAzimuthAngle: 1.2,
}

/** Orbit freedom around an arrival pose (rad, rad, × distance). */
export interface OrbitSlack {
  readonly azimuth: number
  readonly polar: number
  readonly minDistance: number
  readonly maxDistance: number
}

/** Anchored views (pc, tv) only allow a small orbit around the arrival pose. */
export const ANCHOR_SLACK = { azimuth: 0.35, polar: 0.25, minDistance: 0.8, maxDistance: 1.3 } as const satisfies OrbitSlack

/** #work: tighter, so the TV group stays on its side of the notepad card. */
export const WORK_SLACK = { azimuth: 0.22, polar: 0.14, minDistance: 0.88, maxDistance: 1.15 } as const satisfies OrbitSlack

/** Spherical angles of the camera around its target, as OrbitControls measures them (+Y up). */
export function orbitAngles(position: Vector3, target: Vector3): { azimuth: number; polar: number; distance: number } {
  const offset = new Vector3().subVectors(position, target)
  const distance = offset.length()
  return {
    azimuth: Math.atan2(offset.x, offset.z),
    polar: Math.acos(MathUtils.clamp(offset.y / (distance || 1), -1, 1)),
    distance,
  }
}

/**
 * Tight limits around an arrival pose (default ±0.35 rad azimuth, ±0.25 rad
 * polar, 0.8–1.3× distance), intersected with the global limits whenever
 * that still contains the arrival pose.
 */
export function localLimits(position: Vector3, target: Vector3, slack: OrbitSlack = ANCHOR_SLACK): OrbitLimits {
  const { azimuth, polar, distance } = orbitAngles(position, target)
  const g = GLOBAL_LIMITS
  return {
    minDistance: distance * slack.minDistance,
    maxDistance: distance * slack.maxDistance,
    minPolarAngle: Math.max(polar - slack.polar, Math.min(g.minPolarAngle, polar)),
    maxPolarAngle: Math.min(polar + slack.polar, Math.max(g.maxPolarAngle, polar)),
    minAzimuthAngle: Math.max(azimuth - slack.azimuth, Math.min(g.minAzimuthAngle, azimuth)),
    maxAzimuthAngle: Math.min(azimuth + slack.azimuth, Math.max(g.maxAzimuthAngle, azimuth)),
  }
}

/* ------------------------------------------------------------------ */
/* Frames, anchors, route → view                                        */
/* ------------------------------------------------------------------ */

/** Fixed framing: camera = target + normalize(dir) · distance. */
export interface FrameDef {
  readonly target: Vec3
  readonly dir: Vec3
  readonly distance: number
}

/** Framing resolved at runtime by fitting the world box of GLB nodes. */
export interface AnchorDef {
  readonly match: readonly string[]
  readonly dir: Vec3
  readonly fit: number
  /** Flight duration (ms) when flying to this anchor. */
  readonly duration: number
  /** Arc height (m) of the flight waypoint; 0 = straight line. */
  readonly arc: number
}

/**
 * Reference frames (TV centre ≈ (0.04, 1.1, 0.02), camera looking toward −Z).
 * `work` is only the fallback (and the direction) of the composed #work view.
 */
export const FRAMES = {
  home: { target: [0.04, 1.1, 0.02], dir: [-0.13, 0.1, 1], distance: 1.75 },
  work: { target: [0.2, 0.92, 0.02], dir: [-0.06, 0.42, 1], distance: 1.3 },
} as const satisfies Record<string, FrameDef>

/**
 * `pc.dir` is the plan's [.18, .08, 1] expressed in world space: the greybox
 * PC is yawed −0.22 rad toward the desk, so the camera stays ~10° right of
 * the screen normal, as in the reference. `cd` (key M) looks down at the CD
 * player from its front (~40° from vertical), so the LCD strip, the buttons
 * and the lid's disc window all read; a short arc lifts the camera off the desk.
 */
export const ANCHORS = {
  pc: { match: ['pc_monitor'], dir: [-0.04, 0.08, 1], fit: 1.25, duration: 1900, arc: 0.35 },
  tv: { match: ['tv_screen'], dir: [0, 0.05, 1], fit: 1.15, duration: 1200, arc: 0 },
  cd: { match: ['cd_player'], dir: [-0.1, 1.2, 1], fit: 1.35, duration: 1300, arc: 0.12 },
} as const satisfies Record<string, AnchorDef>

export type FrameId = keyof typeof FRAMES
export type AnchorId = keyof typeof ANCHORS
export type ViewId = FrameId | AnchorId

export const ROUTE_VIEW: Readonly<Record<Page, ViewId>> = {
  home: 'home',
  work: 'work',
  about: 'pc',
  online: 'pc',
}

export const DEFAULT_FLIGHT_MS = 1200

export function isFrameId(view: ViewId): view is FrameId {
  return Object.hasOwn(FRAMES, view)
}

export interface ResolvedView {
  readonly id: ViewId
  readonly position: Vector3
  readonly target: Vector3
  readonly duration: number
  readonly arc: number
  readonly limits: OrbitLimits
}

export interface CameraLike {
  readonly fov: number
  readonly aspect: number
}

/** Camera position for a target, a viewing direction and a distance. */
export function positionFor(target: Vector3, dir: Vec3, distance: number): Vector3 {
  return new Vector3(...dir).normalize().multiplyScalar(distance).add(target)
}

/** World box of the named meshes' own geometry (ignores hotspot proxies and other helpers). */
export function boxOfNodes(root: Object3D, names: readonly string[]): Box3 {
  root.updateMatrixWorld(true)
  const box = new Box3()
  const part = new Box3()
  for (const name of names) {
    root.getObjectByName(name)?.traverse((child) => {
      if (!(child instanceof Mesh) || child.userData.hotspotProxy === true) return
      const geometry = child.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (geometry.boundingBox) box.union(part.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld))
    })
  }
  return box
}

/* ------------------------------------------------------------------ */
/* #work composition                                                    */
/* ------------------------------------------------------------------ */

const TAPE_NODES = Array.from({ length: 8 }, (_, i) => `tape_${String(i + 1).padStart(2, '0')}`)

/** Framed on the left of #work; the notepad card (camera-relative) fills the right. */
export const WORK_GROUP: readonly string[] = ['tv_body', 'vcr_body', 'static_shelf', ...TAPE_NODES]

const WORLD_UP = new Vector3(0, 1, 0)

/**
 * #work camera: looks along FRAMES.work's direction and fits the TV group's
 * box into the region `workLayout` leaves for it (left of the card, or the
 * upper half on portrait). Null when the group is missing.
 */
export function workView(scene: Object3D, camera: CameraLike): ResolvedView | null {
  const box = boxOfNodes(scene, WORK_GROUP)
  if (box.isEmpty()) return null
  const notepad = scene.getObjectByName('notepad')
  const card = notepad ? localSize(notepad) : null
  const { group } = workLayout(camera.aspect, card ? card.x / card.y : undefined)

  const back = new Vector3(...FRAMES.work.dir).normalize()
  const forward = back.clone().negate()
  const right = new Vector3().crossVectors(forward, WORLD_UP).normalize()
  const up = new Vector3().crossVectors(right, forward)
  const center = box.getCenter(new Vector3())

  // Half extents of the box across the view (orthographic estimate) and along it.
  let halfW = 0
  let halfH = 0
  let halfD = 0
  const corner = new Vector3()
  for (let i = 0; i < 8; i++) {
    corner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .sub(center)
    halfW = Math.max(halfW, Math.abs(corner.dot(right)))
    halfH = Math.max(halfH, Math.abs(corner.dot(up)))
    halfD = Math.max(halfD, Math.abs(corner.dot(forward)))
  }

  const tanV = Math.tan(MathUtils.degToRad(camera.fov) / 2)
  const tanH = tanV * camera.aspect
  // Fit the near face: the centre sits further back by most of the half depth.
  const distance = Math.max(halfW / (tanH * group.widthFrac), halfH / (tanV * group.heightFrac)) + halfD * 0.6
  // Shift camera and target sideways so the group's centre lands on (ndcX, ndcY).
  const shift = new Vector3()
    .addScaledVector(right, -group.ndcX * tanH * distance)
    .addScaledVector(up, -group.ndcY * tanV * distance)
  const target = center.clone().add(shift)
  const position = target.clone().addScaledVector(back, distance)
  return {
    id: 'work',
    position,
    target,
    duration: DEFAULT_FLIGHT_MS,
    arc: 0,
    limits: localLimits(position, target, WORK_SLACK),
  }
}

/**
 * Resolves a view to a camera pose. Frames are fixed; anchors fit the world
 * box of their matched meshes: distance = (maxDim/2)/tan(fov/2)·fit; #work
 * is composed by `workView`. Missing nodes fall back to the fixed frames.
 */
export function frameFor(view: ViewId, scene: Object3D, camera: CameraLike): ResolvedView {
  if (view === 'work') {
    const composed = workView(scene, camera)
    if (composed) return composed
  }
  if (isFrameId(view)) {
    const frame = FRAMES[view]
    const target = new Vector3(...frame.target)
    return {
      id: view,
      position: positionFor(target, frame.dir, frame.distance),
      target,
      duration: DEFAULT_FLIGHT_MS,
      arc: 0,
      limits: GLOBAL_LIMITS,
    }
  }

  const anchor = ANCHORS[view]
  const box = boxOfNodes(scene, anchor.match)
  if (box.isEmpty()) {
    if (import.meta.env.DEV) console.warn(`[frames] anchor "${view}" matched no meshes: ${anchor.match.join(', ')}`)
    return { ...frameFor('home', scene, camera), id: view }
  }

  const target = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const distance = fitDistance(Math.max(size.x, size.y, size.z), camera.fov, camera.aspect, anchor.fit)
  const position = positionFor(target, anchor.dir, distance)
  return {
    id: view,
    position,
    target,
    duration: anchor.duration,
    arc: anchor.arc,
    limits: localLimits(position, target),
  }
}
