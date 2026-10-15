import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, MathUtils, Mesh, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { fovForAspect, frameFor, type ViewId } from '../camera/frames'
import {
  CITY_FAR,
  CITY_NEAR,
  cityContentTop,
  cylinderParams,
  HORIZON_Y,
  MAX_TOWERS,
  paneAspect,
  rooftops,
  SKY_LAYER,
  yAt,
  type CitySpec,
  type CylinderLayerSpec,
} from './cityLayer'
import { MIST_LAYER } from './mist'
import { advanceMotionTime, MOTION_TIME_WRAP, RAIN_PLANES, REDUCED_MOTION_SPEED } from './rain'

const GLB_PATH = fileURLToPath(new URL('../../assets/models/room.glb', import.meta.url))
const VIEWS: readonly ViewId[] = ['home', 'work', 'pc', 'tv']
/** Viewport aspects the FOV rule has to serve (phone portrait → ultrawide). */
const ASPECTS = [0.46, 0.75, 1, 16 / 9, 2.4]
/** Keep the layer edges at least this far (rad) outside any visible ray. */
const ARC_MARGIN = MathUtils.degToRad(2)
const CAMERA_FAR = 80
/** Art-direction review viewport (800×600). */
const COMPOSITION_ASPECT = 4 / 3

interface Ray {
  readonly origin: Vector3
  readonly dir: Vector3
}

interface Hit {
  /** Angle around the axis (0 = −Z, + = right) and t = tan elevation from HORIZON_Y. */
  readonly s: number
  readonly t: number
  readonly distance: number
}

/** Exit point of a ray (from inside) through a vertical cylinder around `center`. */
function hitCylinder(ray: Ray, center: Vector3, radius: number): Hit {
  const px = ray.origin.x - center.x
  const pz = ray.origin.z - center.z
  const horizontal = Math.hypot(ray.dir.x, ray.dir.z)
  const dx = ray.dir.x / horizontal
  const dz = ray.dir.z / horizontal
  const b = px * dx + pz * dz
  const c = px * px + pz * pz - radius * radius
  const along = -b + Math.sqrt(b * b - c)
  const hx = px + along * dx
  const hz = pz + along * dz
  const y = ray.origin.y + (along / horizontal) * ray.dir.y
  return {
    s: Math.atan2(hx, -hz),
    t: (y - HORIZON_Y) / radius,
    distance: Math.hypot(along, y - ray.origin.y),
  }
}

let rays: Ray[] = []
let city = new Vector3()
let glass = new Vector3()
let opening = new Box3()
let home = { position: new Vector3(), target: new Vector3() }

function node(room: Object3D, name: string): Object3D {
  const object = room.getObjectByName(name)
  if (!object) throw new Error(`missing node ${name}`)
  return object
}

/** Is `dir` inside the view frustum for at least one supported aspect? */
function visible(dir: Vector3, forward: Vector3, right: Vector3, up: Vector3): boolean {
  const z = dir.dot(forward)
  if (z <= 0) return false
  const x = Math.abs(dir.dot(right) / z)
  const y = Math.abs(dir.dot(up) / z)
  return ASPECTS.some((aspect) => {
    const tanV = Math.tan(MathUtils.degToRad(fovForAspect(aspect)) / 2)
    return y <= tanV && x <= tanV * aspect
  })
}

/** Every visible ray through the window opening, for camera poses sampled across each view's orbit limits. */
function windowOpening(room: Object3D): Box3 {
  const glassMesh = node(room, 'window_glass')
  if (!(glassMesh instanceof Mesh)) throw new Error('window_glass is not a mesh')
  glassMesh.geometry.computeBoundingBox()
  return new Box3().copy(glassMesh.geometry.boundingBox ?? new Box3()).applyMatrix4(glassMesh.matrixWorld)
}

function sampleRays(room: Object3D): Ray[] {
  const windowPoints: Vector3[] = []
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 4; j++) {
      windowPoints.push(
        new Vector3(
          MathUtils.lerp(opening.min.x, opening.max.x, i / 8),
          MathUtils.lerp(opening.min.y, opening.max.y, j / 4),
          (opening.min.z + opening.max.z) / 2,
        ),
      )
    }
  }

  // Fixed frames ignore the aspect; anchors fit their box, so sample both extremes.
  const poses = VIEWS.flatMap((view) =>
    (view === 'home' || view === 'work' ? [16 / 9] : [ASPECTS[0] ?? 0.46, 16 / 9]).map((aspect) =>
      frameFor(view, room, { fov: fovForAspect(aspect), aspect }),
    ),
  )
  const result: Ray[] = []
  const forward = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  for (const { target, limits } of poses) {
    for (let a = 0; a <= 16; a++) {
      for (let p = 0; p <= 6; p++) {
        for (let d = 0; d <= 6; d++) {
          const azimuth = MathUtils.lerp(limits.minAzimuthAngle, limits.maxAzimuthAngle, a / 16)
          const polar = MathUtils.lerp(limits.minPolarAngle, limits.maxPolarAngle, p / 6)
          const distance = MathUtils.lerp(limits.minDistance, limits.maxDistance, d / 6)
          const origin = new Vector3().setFromSphericalCoords(distance, polar, azimuth).add(target)
          forward.subVectors(target, origin).normalize()
          right.set(-forward.z, 0, forward.x).normalize()
          up.crossVectors(right, forward)
          for (const point of windowPoints) {
            const dir = new Vector3().subVectors(point, origin)
            if (dir.z >= 0 || !visible(dir, forward, right, up)) continue
            result.push({ origin, dir })
          }
        }
      }
    }
  }
  return result
}

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const room = (await new GLTFLoader().parseAsync(buffer, '')).scene
  room.updateMatrixWorld(true)
  city = node(room, 'anchor_city').getWorldPosition(new Vector3())
  glass = node(room, 'window_glass').getWorldPosition(new Vector3())
  opening = windowOpening(room)
  rays = sampleRays(room)
  home = frameFor('home', room, { fov: fovForAspect(COMPOSITION_ASPECT), aspect: COMPOSITION_ASPECT })
})

function hits(spec: CylinderLayerSpec): Hit[] {
  return rays.map((ray) => hitCylinder(ray, city, spec.radius))
}

// reduce instead of Math.min(...xs): the ray set is too large for spread arguments.
const minOf = (values: readonly number[]): number => values.reduce((a, b) => Math.min(a, b), Infinity)
const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), -Infinity)

describe('window layer coverage (every orbit pose, every supported aspect)', () => {
  it('samples a meaningful set of rays', () => {
    expect(rays.length).toBeGreaterThan(10_000)
  })

  it.each([
    ['sky', SKY_LAYER],
    ['far skyline', CITY_FAR],
    ['near skyline', CITY_NEAR],
    ['mist', MIST_LAYER],
  ] as const)('the %s arc never shows its side edges', (_, spec) => {
    const maxAngle = maxOf(hits(spec).map((hit) => Math.abs(hit.s)))
    expect(maxAngle).toBeLessThan(spec.arc / 2 - ARC_MARGIN)
  })

  it('the near skyline reaches below every ray (its street is opaque)', () => {
    expect(minOf(hits(CITY_NEAR).map((hit) => hit.t))).toBeGreaterThan(CITY_NEAR.tBottom)
  })

  it('the far skyline reaches below every ray not hidden by the near street', () => {
    const near = hits(CITY_NEAR)
    const far = hits(CITY_FAR)
    const open = far.filter((_, i) => (near[i]?.t ?? -Infinity) >= CITY_NEAR.ground)
    expect(minOf(open.map((hit) => hit.t))).toBeGreaterThan(CITY_FAR.tBottom)
  })

  it('the sky covers every ray above both streets, inside the camera far plane', () => {
    const near = hits(CITY_NEAR)
    const far = hits(CITY_FAR)
    const open = hits(SKY_LAYER).filter(
      (_, i) => (near[i]?.t ?? -Infinity) >= CITY_NEAR.ground && (far[i]?.t ?? -Infinity) >= CITY_FAR.ground,
    )
    expect(open.length).toBeGreaterThan(0)
    expect(minOf(open.map((hit) => hit.t))).toBeGreaterThan(SKY_LAYER.tBottom)
    expect(maxOf(open.map((hit) => hit.t))).toBeLessThan(SKY_LAYER.tTop)
    expect(maxOf(open.map((hit) => hit.distance))).toBeLessThan(CAMERA_FAR * 0.95)
  })

  it('the mist cylinder covers every ray vertically', () => {
    const ts = hits(MIST_LAYER).map((hit) => hit.t)
    expect(minOf(ts)).toBeGreaterThan(MIST_LAYER.tBottom)
    expect(maxOf(ts)).toBeLessThan(MIST_LAYER.tTop)
  })

  it.each(RAIN_PLANES.map((spec) => [spec.distance, spec] as const))(
    'the rain plane %d m beyond the glass covers every ray',
    (_, spec) => {
      const z = glass.z - spec.distance
      const cx = glass.x + spec.offset[0]
      const cy = glass.y + spec.offset[1]
      let maxDx = 0
      let maxDy = 0
      for (const { origin, dir } of rays) {
        const k = (z - origin.z) / dir.z
        maxDx = Math.max(maxDx, Math.abs(origin.x + k * dir.x - cx))
        maxDy = Math.max(maxDy, Math.abs(origin.y + k * dir.y - cy))
      }
      expect(maxDx).toBeLessThan(spec.size[0] / 2)
      expect(maxDy).toBeLessThan(spec.size[1] / 2)
    },
  )
})

describe('layer layout helpers', () => {
  it('maps t to world height around the eye line', () => {
    expect(yAt(0, 30)).toBe(HORIZON_Y)
    expect(yAt(0.5, 30)).toBeCloseTo(HORIZON_Y + 15)
  })

  it('builds a cylinder arc centred on −Z with the spec height', () => {
    const params = cylinderParams(CITY_FAR)
    expect(params.thetaStart + params.thetaLength / 2).toBeCloseTo(Math.PI)
    expect(params.thetaLength).toBe(CITY_FAR.arc)
    expect(params.centerY - params.height / 2).toBeCloseTo(yAt(CITY_FAR.tBottom, CITY_FAR.radius))
    expect(params.centerY + params.height / 2).toBeCloseTo(yAt(CITY_FAR.tTop, CITY_FAR.radius))
  })

  it.each([CITY_FAR, CITY_NEAR])('keeps skyline r=$radius content (antennas included) inside its cylinder', (spec) => {
    expect(cityContentTop(spec)).toBeLessThan(spec.tTop)
    expect(spec.ground).toBeGreaterThan(spec.tBottom)
  })

  it('layers sit back to front: sky behind far behind near behind mist', () => {
    const radii = [SKY_LAYER, CITY_FAR, CITY_NEAR, MIST_LAYER].map((spec) => spec.radius)
    expect(radii).toEqual([...radii].sort((a, b) => b - a))
    // Transparent layers draw far → near (lower renderOrder first), all before room transparents (0).
    const orders = [CITY_FAR, CITY_NEAR, MIST_LAYER, ...RAIN_PLANES].map((spec) => spec.renderOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(Math.max(...orders)).toBeLessThan(0)
    expect(SKY_LAYER.renderOrder).toBeGreaterThan(0)
  })
})

/**
 * Art direction (home view, 800×600): where layer heights land as a fraction
 * of the visible window, measured up the centre column of the screen
 * (0 = sill, 1 = top of the visible opening).
 */
describe('home view composition', () => {
  const elevation = (dy: number, horizontal: number) => Math.atan2(dy, horizontal)

  function visibleWindow() {
    const { position, target } = home
    const ahead = Math.hypot(position.x - glass.x, position.z - opening.max.z)
    const sill = elevation(opening.min.y - position.y, ahead)
    const head = elevation(opening.max.y - position.y, ahead)
    const toTarget = new Vector3().subVectors(target, position)
    const pitch = elevation(toTarget.y, Math.hypot(toTarget.x, toTarget.z))
    const halfFov = MathUtils.degToRad(fovForAspect(COMPOSITION_ASPECT)) / 2
    return { bottom: Math.max(sill, pitch - halfFov), top: Math.min(head, pitch + halfFov) }
  }

  /** Fraction of the visible window height at which height t on layer `spec` appears. */
  function fraction(spec: CylinderLayerSpec, t: number): number {
    const { position } = home
    const forward = new Vector3().subVectors(home.target, position).setY(0).normalize()
    const horizontal = hitCylinder({ origin: position, dir: forward }, city, spec.radius).distance
    const e = elevation(yAt(t, spec.radius) - position.y, horizontal)
    const { bottom, top } = visibleWindow()
    return (e - bottom) / (top - bottom)
  }

  const at = (spec: CitySpec, aboveGround: number) => fraction(spec, spec.ground + aboveGround)

  it('puts the far street-light horizon at 35–45% of the window', () => {
    const horizon = at(CITY_FAR, 0)
    expect(horizon).toBeGreaterThan(0.35)
    expect(horizon).toBeLessThan(0.45)
  })

  it('keeps regular far rooftops in the lower ~60% and leaves ≥35% of sky', () => {
    const { median, max } = rooftops(CITY_FAR)
    expect(at(CITY_FAR, median)).toBeLessThan(0.55)
    expect(at(CITY_FAR, max)).toBeLessThan(0.62)
    expect(1 - at(CITY_FAR, max)).toBeGreaterThan(0.35)
  })

  it('has 2–4 towers poking above the skyline, each with one of the 3–5 beacons, all in view', () => {
    const { towers } = CITY_FAR
    expect(towers.length).toBeGreaterThanOrEqual(3)
    expect(towers.length).toBeLessThanOrEqual(Math.min(4, MAX_TOWERS))
    expect(CITY_NEAR.towers).toHaveLength(0)
    for (const tower of towers) {
      expect(at(CITY_FAR, tower.height)).toBeGreaterThan(at(CITY_FAR, rooftops(CITY_FAR).max))
      expect(at(CITY_FAR, tower.height * (1 + tower.mast))).toBeLessThan(0.95)
    }
  })

  it('shows a near street band at the bottom and low/mid-rise near blocks overlapping the far horizon', () => {
    const street = at(CITY_NEAR, 0)
    expect(street).toBeGreaterThan(0)
    expect(street).toBeLessThan(0.2)
    const { median, max } = rooftops(CITY_NEAR)
    expect(at(CITY_NEAR, max)).toBeGreaterThan(at(CITY_FAR, 0))
    expect(at(CITY_NEAR, max)).toBeLessThan(0.5)
    // Mostly 3–8 floors.
    expect(median / CITY_NEAR.floor).toBeGreaterThan(3)
    expect(median / CITY_NEAR.floor).toBeLessThan(8)
    expect(max / CITY_NEAR.floor).toBeLessThan(10)
  })

  it('draws windows taller than wide (1:1.6)', () => {
    expect(paneAspect(CITY_FAR.floor)).toBeCloseTo(1.6)
    expect(paneAspect(CITY_NEAR.floor)).toBeCloseTo(1.6)
  })
})

describe('advanceMotionTime', () => {
  it('runs at full speed normally and 0.4× with reduced motion', () => {
    expect(advanceMotionTime(10, 0.5, false)).toBeCloseTo(10.5)
    expect(advanceMotionTime(10, 0.5, true)).toBeCloseTo(10 + 0.5 * REDUCED_MOTION_SPEED)
  })

  it('wraps to keep float precision and ignores negative deltas', () => {
    expect(advanceMotionTime(MOTION_TIME_WRAP - 0.25, 0.5, false)).toBeCloseTo(0.25)
    expect(advanceMotionTime(3, -1, false)).toBe(3)
  })
})
