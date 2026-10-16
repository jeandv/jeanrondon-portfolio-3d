import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Object3D,
  type Texture,
} from 'three'

/**
 * Room materials, two modes:
 * - 'baked'   (M3+): MeshBasicMaterial with albedo `map` + irradiance `lightMap`
 *   on UV1; lightMapIntensity = π·IRR_SCALE yields exactly albedo × irradiance.
 * - 'greybox' (now): keeps the glTF MeshStandardMaterial (base color) and
 *   relies on realtime lights (see Lights.tsx).
 * The mode is chosen per bake group, so a partial bake still renders.
 */

/** Raise to 2 if irradiance had to be halved in Blender to avoid clipping. */
export const IRR_SCALE = 1

export const BAKE_GROUPS = ['room', 'floor', 'desk', 'gear', 'shelf', 'props'] as const
export type BakeGroup = (typeof BAKE_GROUPS)[number]
export type MaterialMode = 'baked' | 'greybox'
export type TextureSuffix = '' | '_m'

export interface BakeUrls {
  readonly albedo: string
  readonly irrA: string
}

export interface BakeTextures {
  readonly albedo: Texture
  readonly irrA: Texture
}

/** Moving objects stay on realtime-lit standard materials even when baked (plan §5.6). */
export const REALTIME_NODES: ReadonlySet<string> = new Set(['notepad', 'notepad_page', 'polaroid_photo'])

// M3 drops files here as `<group>_albedo[_m].webp` and `<group>_irrA[_m].webp`.
const BAKE_FILES = import.meta.glob<string>('../../assets/bake/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})

const BAKE_FILE = /\/([a-z]+)_(albedo|irrA)(_m)?\.webp$/

function isBakeGroup(value: unknown): value is BakeGroup {
  return typeof value === 'string' && (BAKE_GROUPS as readonly string[]).includes(value)
}

function collectBakeUrls(suffix: TextureSuffix): Partial<Record<BakeGroup, BakeUrls>> {
  const partial: Partial<Record<BakeGroup, { albedo?: string; irrA?: string }>> = {}
  for (const [path, url] of Object.entries(BAKE_FILES)) {
    const match = BAKE_FILE.exec(path)
    if (!match) continue
    const [, group, kind, mobile = ''] = match
    if (!isBakeGroup(group) || mobile !== suffix) continue
    const entry = (partial[group] ??= {})
    if (kind === 'albedo') entry.albedo = url
    else entry.irrA = url
  }
  const complete: Partial<Record<BakeGroup, BakeUrls>> = {}
  for (const group of BAKE_GROUPS) {
    const entry = partial[group]
    if (entry?.albedo && entry.irrA) complete[group] = { albedo: entry.albedo, irrA: entry.irrA }
  }
  return complete
}

const FULL_RES_URLS = collectBakeUrls('')
const MOBILE_URLS = collectBakeUrls('_m')

const BAKE_PATHS: ReadonlyMap<string, string> = new Map(Object.entries(BAKE_FILES).map(([path, url]) => [url, path]))

/** Source path of a bake URL (for its byte size in src/assets/sizes.json). */
export function bakeSourcePath(url: string): string | undefined {
  return BAKE_PATHS.get(url)
}

/** Bake texture URLs per group; phones prefer `_m` files and fall back to full size. */
export function bakeUrlsFor(suffix: TextureSuffix): Partial<Record<BakeGroup, BakeUrls>> {
  return suffix === '_m' ? { ...FULL_RES_URLS, ...MOBILE_URLS } : FULL_RES_URLS
}

export const HAS_BAKES = Object.keys(FULL_RES_URLS).length > 0
export const MATERIAL_MODE: MaterialMode = HAS_BAKES ? 'baked' : 'greybox'

/** Bakes live on UV1 (BakeUV), stored sRGB, glTF orientation. */
export function prepareBakeTexture(texture: Texture): Texture {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  texture.channel = 1
  texture.needsUpdate = true
  return texture
}

export function createBakedMaterial(group: BakeGroup, textures: BakeTextures): MeshBasicMaterial {
  return new MeshBasicMaterial({
    name: `M_${group}`,
    map: prepareBakeTexture(textures.albedo),
    lightMap: prepareBakeTexture(textures.irrA),
    lightMapIntensity: Math.PI * IRR_SCALE,
  })
}

function materialsOf(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function bakeGroupOf(object: Object3D): BakeGroup | undefined {
  const bake: unknown = object.userData.bake
  return isBakeGroup(bake) ? bake : undefined
}

/**
 * The contract node a mesh stands for. Meshopt quantization (optimize-glb)
 * moves the mesh of a node that has children into a new unnamed child node;
 * GLTFLoader only sets `userData.name` on named nodes, so such a mesh speaks
 * for its named parent (its bake group, name and hover highlight).
 */
export function contractNodeOf(object: Object3D): Object3D {
  const parent = object.parent
  const unnamed = object.userData.name === undefined
  return unnamed && parent !== null && typeof parent.userData.name === 'string' ? parent : object
}

function tuneGreybox(material: Material): void {
  if (material.transparent) material.depthWrite = false
}

export interface ApplyMaterialsOptions {
  /** Interactive meshes get their own material copy so hover highlights stay local. */
  readonly isolate?: ReadonlySet<string>
}

/**
 * Assigns room materials once per GLB scene (idempotent; StrictMode-safe).
 * Groups with bake textures go 'baked', everything else stays 'greybox'.
 */
export function applyRoomMaterials(
  root: Object3D,
  textures: Partial<Record<BakeGroup, BakeTextures>>,
  { isolate }: ApplyMaterialsOptions = {},
): MaterialMode {
  const previous: unknown = root.userData.materialMode
  if (previous === 'baked' || previous === 'greybox') return previous

  const shared = new Map<BakeGroup, MeshBasicMaterial>()
  let bakedMeshes = 0
  root.traverse((object) => {
    if (!(object instanceof Mesh) || object.userData.hotspotProxy === true) return
    const node = contractNodeOf(object)
    const group = bakeGroupOf(node)
    const groupTextures = group && !REALTIME_NODES.has(node.name) ? textures[group] : undefined
    if (group && groupTextures) {
      let material = shared.get(group)
      if (!material) {
        material = createBakedMaterial(group, groupTextures)
        shared.set(group, material)
      }
      object.material = material
      bakedMeshes++
    } else {
      materialsOf(object).forEach(tuneGreybox)
    }
    if (isolate?.has(node.name)) isolateMaterial(object)
  })

  const mode: MaterialMode = bakedMeshes > 0 ? 'baked' : 'greybox'
  root.userData.materialMode = mode
  return mode
}

/** Replaces a mesh's (possibly shared) material with its own clone. */
export function isolateMaterial(mesh: Mesh): void {
  if (mesh.userData.ownMaterial === true) return
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone()
  mesh.userData.ownMaterial = true
}

/* ------------------------------------------------------------------ */
/* Hover highlight                                                      */
/* ------------------------------------------------------------------ */

const HOVER_LIGHTMAP_GAIN = 1.2
const HOVER_EMISSIVE = new Color('#ffb867')
const HOVER_EMISSIVE_INTENSITY = 0.15
const HOVER_EMISSIVE_GAIN = 1.6

interface HighlightBase {
  readonly lightMapIntensity: number
  readonly emissive: Color
  readonly emissiveIntensity: number
}

const highlightBases = new WeakMap<Material, HighlightBase>()

function baseOf(material: Material): HighlightBase {
  let base = highlightBases.get(material)
  if (!base) {
    base = {
      lightMapIntensity: material instanceof MeshBasicMaterial ? material.lightMapIntensity : 1,
      emissive: material instanceof MeshStandardMaterial ? material.emissive.clone() : new Color(0),
      emissiveIntensity: material instanceof MeshStandardMaterial ? material.emissiveIntensity : 0,
    }
    highlightBases.set(material, base)
  }
  return base
}

/**
 * Hover bump: baked → lightMapIntensity ×1.2 (π·1.2 at IRR_SCALE 1);
 * greybox → warm emissive tint (or a stronger glow for emissive screens).
 * Call on meshes whose material was isolated first.
 */
export function setHighlight(mesh: Mesh, on: boolean): void {
  for (const material of materialsOf(mesh)) {
    const base = baseOf(material)
    if (material instanceof MeshBasicMaterial) {
      if (material.lightMap) material.lightMapIntensity = base.lightMapIntensity * (on ? HOVER_LIGHTMAP_GAIN : 1)
    } else if (material instanceof MeshStandardMaterial) {
      const glowing = base.emissiveIntensity > 0 && base.emissive.getHex() !== 0
      if (on && glowing) {
        material.emissiveIntensity = base.emissiveIntensity * HOVER_EMISSIVE_GAIN
      } else if (on) {
        material.emissive.copy(HOVER_EMISSIVE)
        material.emissiveIntensity = HOVER_EMISSIVE_INTENSITY
      } else {
        material.emissive.copy(base.emissive)
        material.emissiveIntensity = base.emissiveIntensity
      }
    }
  }
}
