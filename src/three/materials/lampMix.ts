import { MathUtils, type IUniform, type Material, type MeshBasicMaterial, type Texture } from 'three'
import type { BakeGroup } from './baked'

/**
 * Desk lamp on/off for baked materials (plan §10.1). Each bake group has its
 * "lamp on" irradiance (irrA, the lightMap) and an optional "lamp off" bake
 * (irrB). One shared uniform `uLampMix` (0 = on, 1 = off) blends them in the
 * MeshBasicMaterial shader through onBeforeCompile; a group without irrB
 * fakes it by scaling irrA (LAMP_OFF_FACTOR) so the toggle still reads.
 * irrB arrives after the room is live: swapping the sampler needs no recompile.
 */

/** Fade (s) between on and off; reduced motion snaps. */
export const LAMP_FADE_SECONDS = 0.25
/** irrA × this stands in for a missing lamp-off bake. */
export const LAMP_OFF_FACTOR = 0.55

/** Shared by every baked material and read by the realtime lamp rig. */
export const LAMP_MIX: IUniform<number> = { value: 0 }

export function lampMixTarget(on: boolean): number {
  return on ? 0 : 1
}

/** Linear ramp toward `target` at 1 / LAMP_FADE_SECONDS per second (`snap`: jump). */
export function stepLampMix(current: number, target: number, dt: number, snap = false): number {
  if (snap) return target
  const step = Math.max(0, dt) / LAMP_FADE_SECONDS
  const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step)
  // Land exactly (float steps would otherwise stop a hair short).
  return Math.abs(target - next) < 1e-6 ? target : next
}

/** Irradiance with the lamp off: the irrB value, or irrA × factor without one. */
export function lampOffIrradiance(irrA: number, irrB: number | null, factor = LAMP_OFF_FACTOR): number {
  return irrB ?? irrA * factor
}

/** What the shader computes per channel: mix(irrA, irrB·scale, mix). */
export function mixedIrradiance(irrA: number, irrB: number | null, mix: number, factor = LAMP_OFF_FACTOR): number {
  return MathUtils.lerp(irrA, lampOffIrradiance(irrA, irrB, factor), MathUtils.clamp(mix, 0, 1))
}

/* ------------------------------------------------------------------ */
/* Per-group uniforms                                                   */
/* ------------------------------------------------------------------ */

export interface GroupLampUniforms {
  /** The lamp-off bake; irrA itself until (unless) irrB loads. */
  readonly uIrrB: IUniform<Texture | null>
  /** 1 with a real irrB, LAMP_OFF_FACTOR while it stands in with irrA. */
  readonly uIrrBScale: IUniform<number>
}

const groups = new Map<BakeGroup, GroupLampUniforms>()

/** The group's lamp uniforms (created on first use with irrA as the stand-in). */
export function groupLampUniforms(group: BakeGroup, irrA: Texture | null): GroupLampUniforms {
  let uniforms = groups.get(group)
  if (!uniforms) {
    uniforms = { uIrrB: { value: irrA }, uIrrBScale: { value: LAMP_OFF_FACTOR } }
    groups.set(group, uniforms)
  }
  return uniforms
}

/** Plugs in a loaded lamp-off bake (prepared like the other bakes). */
export function setLampOffBake(group: BakeGroup, texture: Texture): void {
  const uniforms = groupLampUniforms(group, texture)
  uniforms.uIrrB.value = texture
  uniforms.uIrrBScale.value = 1
}

export function hasLampOffBake(group: BakeGroup): boolean {
  return groups.get(group)?.uIrrBScale.value === 1
}

/** The loaded lamp-off bake of a group, if any. */
export function lampOffBake(group: BakeGroup): Texture | null {
  return hasLampOffBake(group) ? (groups.get(group)?.uIrrB.value ?? null) : null
}

/** Tests: forget every group. */
export function resetLampGroups(): void {
  groups.clear()
  LAMP_MIX.value = 0
}

/* ------------------------------------------------------------------ */
/* Shader patch                                                         */
/* ------------------------------------------------------------------ */

export const LAMP_SHADER_KEY = 'lamp-mix-v1'

const LIGHTMAP_SAMPLE = /vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);/

const DECLARATIONS = /* glsl */ `uniform sampler2D uIrrB;
uniform float uIrrBScale;
uniform float uLampMix;
`

/** Pure: blends irrB into MeshBasicMaterial's lightmap sample (null if three's code moved). */
export function injectLampMix(fragment: string): string | null {
  if (!LIGHTMAP_SAMPLE.test(fragment)) return null
  const mixed = fragment.replace(
    LIGHTMAP_SAMPLE,
    (sample) => `${sample}\n\t\tlightMapTexel.rgb = mix( lightMapTexel.rgb, texture2D( uIrrB, vLightMapUv ).rgb * uIrrBScale, uLampMix );`,
  )
  return DECLARATIONS + mixed
}

const patched = new WeakMap<Material, BakeGroup>()

/** Hooks a baked group material to the lamp mix (idempotent). */
export function patchLampMix(material: MeshBasicMaterial, group: BakeGroup): void {
  const uniforms = groupLampUniforms(group, material.lightMap)
  material.onBeforeCompile = (shader) => {
    const fragment = injectLampMix(shader.fragmentShader)
    if (fragment === null) {
      if (import.meta.env.DEV) console.warn('[lamp] MeshBasicMaterial lightmap code not found; lamp-off bake disabled')
      return
    }
    shader.uniforms.uLampMix = LAMP_MIX
    shader.uniforms.uIrrB = uniforms.uIrrB
    shader.uniforms.uIrrBScale = uniforms.uIrrBScale
    shader.fragmentShader = fragment
  }
  material.customProgramCacheKey = () => LAMP_SHADER_KEY
  patched.set(material, group)
}

/** The group a material was patched for (clones lose onBeforeCompile and must be re-patched). */
export function lampGroupOf(material: Material): BakeGroup | undefined {
  return patched.get(material)
}
