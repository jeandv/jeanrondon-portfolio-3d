import { DstColorFactor, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Uniform, Vector2, ZeroFactor } from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyGlass,
  createDropletMaterial,
  createGlassMaterial,
  DROPLETS,
  DROPLETS_RENDER_ORDER,
  GLASS_NODE,
  GLASS_RENDER_ORDER,
  glassFrame,
  glassTint,
  setDropletsRunning,
} from './glass'

/** A glTF-style plane: v grows downward (three's PlaneGeometry has v up). */
function gltfPlane(width: number, height: number): PlaneGeometry {
  const geometry = new PlaneGeometry(width, height)
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  return geometry
}

describe('window glass', () => {
  it('keeps the multiplicative tint (dst × tint)', () => {
    const material = createGlassMaterial()
    expect(material.color.equals(glassTint())).toBe(true)
    // dst × src (the tint) + 0: nothing is added to the view.
    expect(material.blendSrc).toBe(DstColorFactor)
    expect(material.blendDst).toBe(ZeroFactor)
  })

  it('reads the glass size and orientation from its UVs (node scale included)', () => {
    const frame = glassFrame(new Mesh(gltfPlane(2.4, 1.35)))
    expect(frame?.width).toBeCloseTo(2.4)
    expect(frame?.height).toBeCloseTo(1.35)
    expect(frame?.vDown).toBe(true)
    expect(glassFrame(new Mesh(new PlaneGeometry(2, 1)))?.vDown).toBe(false)
    const scaled = new Mesh(gltfPlane(1, 1))
    scaled.scale.set(2, 0.5, 1)
    expect(glassFrame(scaled)).toMatchObject({ width: 2, height: 0.5, vDown: true })
  })

  it('lays the raindrops over the glass on a second mesh and restores everything', () => {
    const room = new Group()
    const original = new MeshBasicMaterial()
    const glass = new Mesh(gltfPlane(2.4, 1.35), original)
    glass.name = GLASS_NODE
    room.add(glass)
    const tint = createGlassMaterial()
    const droplets = createDropletMaterial(new Uniform(0))
    const restore = applyGlass(room, tint, droplets)

    expect(glass.material).toBe(tint)
    expect(glass.renderOrder).toBe(GLASS_RENDER_ORDER)
    const overlay = glass.children[0]
    expect(overlay instanceof Mesh && overlay.geometry === glass.geometry && overlay.material === droplets).toBe(true)
    expect(overlay?.renderOrder).toBe(DROPLETS_RENDER_ORDER)
    expect(DROPLETS_RENDER_ORDER).toBeGreaterThan(GLASS_RENDER_ORDER)
    expect(overlay?.userData.runtimeHelper).toBe(true)
    const size: unknown = droplets.uniforms.uSize?.value
    expect(size instanceof Vector2 && size.x).toBeCloseTo(2.4)

    restore()
    expect(glass.material).toBe(original)
    expect(glass.children).toHaveLength(0)
  })

  it('drops stop running with reduced motion', () => {
    const droplets = createDropletMaterial(new Uniform(0))
    setDropletsRunning(droplets, false)
    expect(droplets.uniforms.uRunning?.value).toBe(0)
    setDropletsRunning(droplets, true)
    expect(droplets.uniforms.uRunning?.value).toBe(1)
  })

  it('keeps every bead inside its grid cell, and readable from the desk', () => {
    for (const layer of [DROPLETS.fine, DROPLETS.coarse]) {
      // Centres sit 0.3–0.7 of a cell: the largest radius (×1.12 tall) must stay inside.
      expect(layer.radius[1] * 1.12).toBeLessThan(0.3 * layer.cell)
      // ≥ ~1 px at 1280×720 from the home camera (~2.2 m, 32° fov: ~1.7 mm per px).
      expect(layer.radius[0] * 2).toBeGreaterThan(0.0025)
    }
    const { column, head, trail } = DROPLETS.runners
    // Head plus wobble (6 mm) stays inside its lane.
    expect(Math.max(...head) + 0.006).toBeLessThan(column / 2)
    expect(trail).toBeGreaterThan(0)
  })
})
