import type { EffectComposer } from 'postprocessing'
import { Mesh, MeshBasicMaterial, type Material, type Object3D, type Texture } from 'three'
import type { QualityInfo } from '../quality/tiers'

/**
 * Dev-only render statistics (plan §7 / §11.5): `window.__renderInfo()` in
 * the browser console or from Playwright. Budget: ≤ 80 scene draw calls
 * (cap 150), ≤ 300k triangles.
 */

export interface DrawStats {
  readonly calls: number
  readonly triangles: number
  readonly points: number
  readonly lines: number
}

export interface PassInfo {
  readonly name: string
  readonly enabled: boolean
}

export interface MaterialSummary {
  /** `baked` / `greybox` (applyRoomMaterials), or `unknown` before the room is set up. */
  readonly mode: string
  /** Rendered meshes (visible material) in the scene. */
  readonly meshes: number
  /** Distinct material instances on those meshes. */
  readonly materials: number
  /** Mesh count per material type. */
  readonly byType: Readonly<Record<string, number>>
  /** Meshes on a MeshBasicMaterial with an irradiance lightMap (baked path). */
  readonly lightMapped: number
  /** Distinct lightMap UV channels / intensities among them (expect [1] / [π·IRR_SCALE]). */
  readonly lightMapChannels: readonly number[]
  readonly lightMapIntensities: readonly number[]
  /** Baked meshes whose albedo or lightMap has no image (they would render black). */
  readonly missingBakeImages: readonly string[]
}

export interface RenderInfoSnapshot {
  /** Last composed frame: scene + every post pass. */
  readonly frame: DrawStats
  /** One scene render (what the RenderPass draws), measured on demand. */
  readonly scene: DrawStats
  /** frame − scene: the post-processing chain. */
  readonly post: DrawStats
  readonly programs: number
  readonly textures: number
  readonly geometries: number
  /** EffectComposer passes, in order. */
  readonly passes: readonly PassInfo[]
  readonly dpr: number
  readonly size: { readonly width: number; readonly height: number }
  readonly materials: MaterialSummary
  /** Adaptive quality tier (null before live and in ?capture). */
  readonly quality: QualityInfo | null
}

declare global {
  interface Window {
    __renderInfo?: () => RenderInfoSnapshot
    /** Dev: CSS px of a GLB node's world box centre (null if missing / behind the camera). */
    __screenPoint?: (name: string) => { x: number; y: number } | null
  }
}

export const EMPTY_STATS: DrawStats = { calls: 0, triangles: 0, points: 0, lines: 0 }

let devComposer: EffectComposer | null = null

/** Callback ref for PostFX's <EffectComposer> (dev only). */
export function registerDevComposer(composer: EffectComposer | null): void {
  devComposer = composer
}

export function devComposerPasses(): PassInfo[] {
  return devComposer?.passes.map((pass) => ({ name: pass.name, enabled: pass.enabled })) ?? []
}

export function subtractStats(a: DrawStats, b: DrawStats): DrawStats {
  return {
    calls: Math.max(0, a.calls - b.calls),
    triangles: Math.max(0, a.triangles - b.triangles),
    points: Math.max(0, a.points - b.points),
    lines: Math.max(0, a.lines - b.lines),
  }
}

function hasImage(texture: Texture | null): boolean {
  const image: unknown = texture?.image
  if (!image || typeof image !== 'object') return false
  const { width } = image as { width?: unknown }
  return typeof width === 'number' && width > 0
}

const round = (value: number) => Math.round(value * 1e4) / 1e4

/** Material census of a scene (pure: no renderer needed). */
export function summarizeMaterials(scene: Object3D, room?: Object3D): MaterialSummary {
  const distinct = new Set<Material>()
  const byType: Record<string, number> = {}
  const channels = new Set<number>()
  const intensities = new Set<number>()
  const missing: string[] = []
  let meshes = 0
  let lightMapped = 0

  scene.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    const list: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    const shown = list.filter((material) => material.visible)
    if (shown.length === 0) return
    meshes++
    for (const material of shown) {
      distinct.add(material)
      byType[material.type] = (byType[material.type] ?? 0) + 1
      if (material instanceof MeshBasicMaterial && material.lightMap) {
        lightMapped++
        channels.add(material.lightMap.channel)
        intensities.add(round(material.lightMapIntensity))
        if (!hasImage(material.map) || !hasImage(material.lightMap)) missing.push(object.name || object.uuid)
      }
    }
  })

  const mode: unknown = room?.userData.materialMode
  return {
    mode: typeof mode === 'string' ? mode : 'unknown',
    meshes,
    materials: distinct.size,
    byType,
    lightMapped,
    lightMapChannels: [...channels].sort((a, b) => a - b),
    lightMapIntensities: [...intensities].sort((a, b) => a - b),
    missingBakeImages: missing,
  }
}
