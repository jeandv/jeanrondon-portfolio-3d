import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  type Material,
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyRoomMaterials,
  contractNodeOf,
  createBakedMaterial,
  HAS_BAKES,
  IRR_SCALE,
  isolateMaterial,
  MATERIAL_MODE,
  prepareBakeTexture,
  setHighlight,
  type BakeTextures,
} from './baked'

const geometry = new BoxGeometry()

/** A GLB-like node: named like GLTFLoader does (name + userData.name), with extras. */
function node(name: string, extras: Record<string, unknown> = {}, material: Material = new MeshStandardMaterial()): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  mesh.userData = { name, ...extras }
  return mesh
}

function textures(): BakeTextures {
  return { albedo: new Texture(), irrA: new Texture() }
}

function materialOf(mesh: Mesh): Material {
  if (Array.isArray(mesh.material)) throw new Error('expected a single material')
  return mesh.material
}

describe('baked material factory', () => {
  it('builds albedo × irradiance on UV1: MeshBasicMaterial, lightMapIntensity = π·IRR_SCALE', () => {
    const maps = textures()
    const material = createBakedMaterial('desk', maps)
    expect(material).toBeInstanceOf(MeshBasicMaterial)
    expect(material.name).toBe('M_desk')
    expect(material.map).toBe(maps.albedo)
    expect(material.lightMap).toBe(maps.irrA)
    expect(material.lightMapIntensity).toBeCloseTo(Math.PI * IRR_SCALE)
    for (const texture of [maps.albedo, maps.irrA]) {
      expect(texture.channel).toBe(1)
      expect(texture.flipY).toBe(false)
      expect(texture.colorSpace).toBe(SRGBColorSpace)
    }
  })

  it('flags a prepared texture for re-upload', () => {
    const texture = new Texture()
    const version = texture.version
    prepareBakeTexture(texture)
    expect(texture.version).toBeGreaterThan(version)
  })

  it('follows the bake files on disk', () => {
    expect(MATERIAL_MODE).toBe(HAS_BAKES ? 'baked' : 'greybox')
  })
})

describe('applyRoomMaterials', () => {
  function room() {
    const root = new Group()
    const parts = {
      desk: node('static_desk', { bake: 'desk' }),
      tv: node('tv_body', { bake: 'gear' }),
      vcr: node('vcr_body', { bake: 'gear' }),
      notepad: node('notepad', { bake: 'props' }),
      screen: node('tv_screen'),
      shelf: node('static_shelf', { bake: 'shelf' }),
      proxy: node('proxy', { bake: 'gear', hotspotProxy: true }, new MeshBasicMaterial({ visible: false })),
    }
    root.add(...Object.values(parts))
    return { root, parts }
  }

  it('shares one material per baked group and leaves the rest alone', () => {
    const { root, parts } = room()
    const originals = new Map(Object.entries(parts).map(([key, mesh]) => [key, materialOf(mesh)]))
    const mode = applyRoomMaterials(root, { desk: textures(), gear: textures(), props: textures() })

    expect(mode).toBe('baked')
    expect(root.userData.materialMode).toBe('baked')
    expect(materialOf(parts.desk).name).toBe('M_desk')
    expect(materialOf(parts.tv)).toBe(materialOf(parts.vcr))
    expect(materialOf(parts.tv).name).toBe('M_gear')
    // Realtime nodes, unbaked surfaces, groups without textures and proxies keep theirs.
    expect(materialOf(parts.notepad)).toBe(originals.get('notepad'))
    expect(materialOf(parts.screen)).toBe(originals.get('screen'))
    expect(materialOf(parts.shelf)).toBe(originals.get('shelf'))
    expect(materialOf(parts.proxy)).toBe(originals.get('proxy'))
  })

  it('gives isolated (interactive) meshes their own copy', () => {
    const { root, parts } = room()
    applyRoomMaterials(root, { gear: textures() }, { isolate: new Set(['tv_body']) })
    const tv = materialOf(parts.tv)
    const vcr = materialOf(parts.vcr)
    expect(tv).not.toBe(vcr)
    expect(tv).toBeInstanceOf(MeshBasicMaterial)
    expect((tv as MeshBasicMaterial).lightMap).toBe((vcr as MeshBasicMaterial).lightMap)
  })

  it('is idempotent (StrictMode remounts)', () => {
    const { root, parts } = room()
    applyRoomMaterials(root, { gear: textures() })
    const first = materialOf(parts.tv)
    expect(applyRoomMaterials(root, { gear: textures() })).toBe('baked')
    expect(materialOf(parts.tv)).toBe(first)
  })

  it('stays greybox without textures and stops transparent depth writes', () => {
    const { root, parts } = room()
    const glass = node('window_glass', {}, new MeshStandardMaterial({ transparent: true }))
    root.add(glass)
    expect(applyRoomMaterials(root, {})).toBe('greybox')
    expect(materialOf(parts.tv)).toBeInstanceOf(MeshStandardMaterial)
    expect(materialOf(glass).depthWrite).toBe(false)
  })

  it('treats a quantization child (unnamed node) as its named parent', () => {
    // optimize-glb: a node with children gets its mesh moved into an unnamed child node.
    const root = new Group()
    const monitor = new Group()
    monitor.name = 'pc_monitor'
    monitor.userData = { name: 'pc_monitor', bake: 'gear' }
    const moved = new Mesh(geometry, new MeshStandardMaterial())
    moved.name = 'pc_monitor_1'
    monitor.add(moved, node('pc_screen'))
    root.add(monitor)

    expect(contractNodeOf(moved)).toBe(monitor)
    applyRoomMaterials(root, { gear: textures() }, { isolate: new Set(['pc_monitor']) })
    expect(materialOf(moved).name).toBe('M_gear')
    expect(moved.userData.ownMaterial).toBe(true)
  })
})

describe('hover highlight', () => {
  it('bumps a baked lightmap ×1.2 and restores it', () => {
    const mesh = node('tv_body', { bake: 'gear' }, createBakedMaterial('gear', textures()))
    isolateMaterial(mesh)
    const material = materialOf(mesh) as MeshBasicMaterial
    setHighlight(mesh, true)
    expect(material.lightMapIntensity).toBeCloseTo(Math.PI * IRR_SCALE * 1.2)
    setHighlight(mesh, false)
    expect(material.lightMapIntensity).toBeCloseTo(Math.PI * IRR_SCALE)
  })

  it('tints a greybox material warm and restores its emissive', () => {
    const mesh = node('vcr_body', { bake: 'gear' }, new MeshStandardMaterial({ emissive: 0x000000 }))
    const material = materialOf(mesh) as MeshStandardMaterial
    setHighlight(mesh, true)
    expect(material.emissive.getHexString()).toBe('ffb867')
    expect(material.emissiveIntensity).toBeCloseTo(0.15)
    setHighlight(mesh, false)
    expect(material.emissive.getHex()).toBe(0)
  })
})
