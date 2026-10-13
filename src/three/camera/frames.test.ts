import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { fitDistance, fovForAspect, FRAMES, frameFor, GLOBAL_LIMITS, localLimits, orbitAngles, ROUTE_VIEW } from './frames'

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180)

describe('fovForAspect', () => {
  it('keeps the base 32° vertical FOV on landscape screens', () => {
    expect(fovForAspect(16 / 9)).toBeCloseTo(32, 6)
    expect(fovForAspect(21 / 9)).toBeCloseTo(32, 6)
  })

  it('caps portrait at 2·atan(0.62)', () => {
    expect(fovForAspect(390 / 844)).toBeCloseTo((2 * Math.atan(0.62) * 180) / Math.PI, 6)
    expect(fovForAspect(0.2)).toBeCloseTo(63.597, 2)
  })

  it('widens monotonically as the screen narrows, preserving horizontal coverage', () => {
    expect(fovForAspect(0.75)).toBeGreaterThan(fovForAspect(1.2))
    expect(fovForAspect(1)).toBeGreaterThan(32)
    // Between the clamps the horizontal half-angle tangent stays at 0.29.
    for (const aspect of [0.5, 0.75, 1]) {
      expect(tan(fovForAspect(aspect) / 2) * aspect).toBeCloseTo(0.29, 6)
    }
  })
})

describe('fitDistance', () => {
  it('is (maxDim/2)/tan(fov/2)·fit on landscape screens', () => {
    expect(fitDistance(0.4, 32, 16 / 9, 1)).toBeCloseTo(0.2 / tan(16), 9)
    expect(fitDistance(0.4, 32, 16 / 9, 1.15)).toBeCloseTo((0.2 / tan(16)) * 1.15, 9)
  })

  it('uses the horizontal half-angle on portrait screens', () => {
    const aspect = 390 / 844
    const fov = fovForAspect(aspect)
    expect(fitDistance(0.4, fov, aspect, 1)).toBeCloseTo(0.2 / (tan(fov / 2) * aspect), 9)
    expect(fitDistance(0.4, fov, aspect, 1)).toBeGreaterThan(fitDistance(0.4, fov, 1, 1))
  })
})

describe('frameFor', () => {
  const camera = { fov: 32, aspect: 16 / 9 }

  it('places fixed frames at target + normalize(dir)·distance', () => {
    const view = frameFor('home', new Scene(), camera)
    const { target, dir, distance } = FRAMES.home
    expect(view.target.toArray()).toEqual([...target])
    expect(view.position.distanceTo(view.target)).toBeCloseTo(distance, 9)
    const direction = view.position.clone().sub(view.target).normalize()
    expect(direction.dot(new Vector3(...dir).normalize())).toBeCloseTo(1, 9)
    expect(view.limits).toBe(GLOBAL_LIMITS)
  })

  it('fits anchors to the world box of the matched mesh', () => {
    const scene = new Scene()
    const screen = new Mesh(new PlaneGeometry(0.4, 0.3), new MeshBasicMaterial())
    screen.name = 'tv_screen'
    screen.position.set(0.015, 1.075, 0.222)
    scene.add(screen)

    const view = frameFor('tv', scene, camera)
    expect(view.target.distanceTo(screen.position)).toBeLessThan(1e-9)
    expect(view.position.distanceTo(view.target)).toBeCloseTo((0.2 / tan(16)) * 1.15, 6)
    expect(view.position.z).toBeGreaterThan(screen.position.z)
  })

  it('falls back to the home frame when the anchor nodes are missing', () => {
    const view = frameFor('pc', new Scene(), camera)
    expect(view.id).toBe('pc')
    expect(view.target.toArray()).toEqual([...FRAMES.home.target])
  })

  it('home and work poses respect the global orbit limits', () => {
    for (const id of ['home', 'work'] as const) {
      const view = frameFor(id, new Scene(), camera)
      const { azimuth, polar, distance } = orbitAngles(view.position, view.target)
      expect(azimuth).toBeGreaterThanOrEqual(GLOBAL_LIMITS.minAzimuthAngle)
      expect(azimuth).toBeLessThanOrEqual(GLOBAL_LIMITS.maxAzimuthAngle)
      expect(polar).toBeGreaterThanOrEqual(GLOBAL_LIMITS.minPolarAngle)
      expect(polar).toBeLessThanOrEqual(GLOBAL_LIMITS.maxPolarAngle)
      expect(distance).toBeLessThanOrEqual(GLOBAL_LIMITS.maxDistance)
    }
  })
})

describe('localLimits', () => {
  it('wraps the arrival pose with ±0.35 azimuth, ±0.25 polar and 0.8–1.3× distance', () => {
    const target = new Vector3(1, 1, 0)
    const position = target.clone().add(new Vector3(-0.04, 0.08, 1).normalize())
    const { azimuth, polar } = orbitAngles(position, target)
    const limits = localLimits(position, target)
    expect(limits.minAzimuthAngle).toBeCloseTo(azimuth - 0.35, 9)
    expect(limits.maxAzimuthAngle).toBeCloseTo(azimuth + 0.35, 9)
    expect(limits.minPolarAngle).toBeCloseTo(polar - 0.25, 9)
    // Upper polar bound is clipped by the global 1.72 limit.
    expect(limits.maxPolarAngle).toBeCloseTo(Math.min(polar + 0.25, GLOBAL_LIMITS.maxPolarAngle), 9)
    expect(limits.minDistance).toBeCloseTo(0.8, 9)
    expect(limits.maxDistance).toBeCloseTo(1.3, 9)
  })
})

describe('ROUTE_VIEW', () => {
  it('maps pages to views', () => {
    expect(ROUTE_VIEW).toEqual({ home: 'home', work: 'work', about: 'pc', online: 'pc' })
  })
})
