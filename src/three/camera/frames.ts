import { Box3, MathUtils, Mesh, Vector3, type Object3D } from 'three'
import type { Page } from '../../state/router'

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

/** Anchored views (pc, tv) only allow a small orbit around the arrival pose. */
export const ANCHOR_SLACK = { azimuth: 0.35, polar: 0.25, minDistance: 0.8, maxDistance: 1.3 } as const

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
 * Tight limits around an arrival pose: ±0.35 rad azimuth, ±0.25 rad polar,
 * 0.8–1.3× distance, intersected with the global limits whenever that still
 * contains the arrival pose.
 */
export function localLimits(position: Vector3, target: Vector3): OrbitLimits {
  const { azimuth, polar, distance } = orbitAngles(position, target)
  const g = GLOBAL_LIMITS
  return {
    minDistance: distance * ANCHOR_SLACK.minDistance,
    maxDistance: distance * ANCHOR_SLACK.maxDistance,
    minPolarAngle: Math.max(polar - ANCHOR_SLACK.polar, Math.min(g.minPolarAngle, polar)),
    maxPolarAngle: Math.min(polar + ANCHOR_SLACK.polar, Math.max(g.maxPolarAngle, polar)),
    minAzimuthAngle: Math.max(azimuth - ANCHOR_SLACK.azimuth, Math.min(g.minAzimuthAngle, azimuth)),
    maxAzimuthAngle: Math.min(azimuth + ANCHOR_SLACK.azimuth, Math.max(g.maxAzimuthAngle, azimuth)),
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

/** Reference frames (TV centre ≈ (0.04, 1.1, 0.02), camera looking toward −Z). */
export const FRAMES = {
  home: { target: [0.04, 1.1, 0.02], dir: [-0.13, 0.1, 1], distance: 1.75 },
  work: { target: [0.2, 0.92, 0.02], dir: [-0.06, 0.42, 1], distance: 1.3 },
} as const satisfies Record<string, FrameDef>

/**
 * `pc.dir` is the plan's [.18, .08, 1] expressed in world space: the greybox
 * PC is yawed −0.22 rad toward the desk, so the camera stays ~10° right of
 * the screen normal, as in the reference.
 */
export const ANCHORS = {
  pc: { match: ['pc_monitor'], dir: [-0.04, 0.08, 1], fit: 1.25, duration: 1900, arc: 0.35 },
  tv: { match: ['tv_screen'], dir: [0, 0.05, 1], fit: 1.15, duration: 1200, arc: 0 },
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

/**
 * Resolves a view to a camera pose. Frames are fixed; anchors fit the world
 * box of their matched meshes: distance = (maxDim/2)/tan(fov/2)·fit.
 * Missing anchor nodes fall back to the home frame.
 */
export function frameFor(view: ViewId, scene: Object3D, camera: CameraLike): ResolvedView {
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
