import { Mesh, MeshBasicMaterial, ShaderLib, Texture, BoxGeometry, type WebGLProgramParametersWithUniforms } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { createBakedMaterial, isolateMaterial } from './baked'
import {
  groupLampUniforms,
  hasLampOffBake,
  injectLampMix,
  LAMP_FADE_SECONDS,
  LAMP_MIX,
  LAMP_OFF_FACTOR,
  LAMP_SHADER_KEY,
  lampGroupOf,
  lampMixTarget,
  lampOffIrradiance,
  mixedIrradiance,
  resetLampGroups,
  setLampOffBake,
  stepLampMix,
} from './lampMix'

afterEach(() => resetLampGroups())

describe('lamp mix value', () => {
  it('targets 0 with the lamp on and 1 with it off', () => {
    expect(lampMixTarget(true)).toBe(0)
    expect(lampMixTarget(false)).toBe(1)
  })

  it(`fades linearly over ${LAMP_FADE_SECONDS * 1000} ms, both ways, and snaps on request`, () => {
    let mix = 0
    let frames = 0
    while (mix < 1 && frames < 100) {
      mix = stepLampMix(mix, 1, 1 / 60)
      frames++
    }
    expect(frames).toBe(Math.ceil(LAMP_FADE_SECONDS * 60))
    expect(stepLampMix(1, 0, LAMP_FADE_SECONDS / 2)).toBeCloseTo(0.5)
    expect(stepLampMix(0.3, 1, 1 / 60, true)).toBe(1)
    expect(stepLampMix(0.5, 0.5, 1)).toBe(0.5)
  })

  it('falls back to irrA × factor without a lamp-off bake', () => {
    expect(lampOffIrradiance(0.8, null)).toBeCloseTo(0.8 * LAMP_OFF_FACTOR)
    expect(lampOffIrradiance(0.8, 0.1)).toBe(0.1)
    expect(mixedIrradiance(0.8, null, 0)).toBeCloseTo(0.8)
    expect(mixedIrradiance(0.8, null, 1)).toBeCloseTo(0.8 * LAMP_OFF_FACTOR)
    expect(mixedIrradiance(0.8, 0.2, 0.5)).toBeCloseTo(0.5)
    expect(mixedIrradiance(0.8, 0.2, 7)).toBeCloseTo(0.2)
  })
})

describe('baked shader patch', () => {
  function textures() {
    return { albedo: new Texture(), irrA: new Texture() }
  }

  it('blends uIrrB into MeshBasicMaterial’s lightmap sample', () => {
    const fragment = injectLampMix(ShaderLib.basic.fragmentShader)
    expect(fragment).not.toBeNull()
    expect(fragment).toContain('uniform sampler2D uIrrB;')
    expect(fragment).toContain('uniform float uLampMix;')
    expect(fragment).toMatch(/lightMapTexel\.rgb = mix\( lightMapTexel\.rgb, texture2D\( uIrrB, vLightMapUv \)\.rgb \* uIrrBScale, uLampMix \);/)
    expect(injectLampMix('void main() {}')).toBeNull()
  })

  it('shares one uLampMix; a group stands in irrA × factor until its irrB arrives', () => {
    const material = createBakedMaterial('desk', textures())
    const shader = {
      uniforms: {},
      fragmentShader: ShaderLib.basic.fragmentShader,
      vertexShader: ShaderLib.basic.vertexShader,
    } as unknown as WebGLProgramParametersWithUniforms
    material.onBeforeCompile(shader, undefined as never)
    expect(shader.uniforms.uLampMix).toBe(LAMP_MIX)
    expect(shader.uniforms.uIrrB?.value).toBe(material.lightMap)
    expect(shader.uniforms.uIrrBScale?.value).toBe(LAMP_OFF_FACTOR)
    expect(material.customProgramCacheKey()).toBe(LAMP_SHADER_KEY)
    expect(hasLampOffBake('desk')).toBe(false)

    const irrB = new Texture()
    setLampOffBake('desk', irrB)
    expect(hasLampOffBake('desk')).toBe(true)
    // Same uniform objects: no recompile, the live program sees the new sampler.
    expect(shader.uniforms.uIrrB?.value).toBe(irrB)
    expect(shader.uniforms.uIrrBScale?.value).toBe(1)
    expect(groupLampUniforms('desk', null).uIrrB.value).toBe(irrB)
  })

  it('re-hooks isolated (hover) clones, which lose onBeforeCompile', () => {
    const mesh = new Mesh(new BoxGeometry(), createBakedMaterial('gear', textures()))
    isolateMaterial(mesh)
    const clone = mesh.material
    expect(clone).toBeInstanceOf(MeshBasicMaterial)
    expect(lampGroupOf(clone as MeshBasicMaterial)).toBe('gear')
    expect((clone as MeshBasicMaterial).customProgramCacheKey()).toBe(LAMP_SHADER_KEY)
  })
})
