import { BlendFunction, BloomEffect, EffectAttribute, EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { PerspectiveCamera, ShaderMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { FilmEffect } from './FilmEffect'
import { LensEffect } from './LensEffect'

/** The plan §5.8 chain, built the way @react-three/postprocessing builds it. */
function chain() {
  const lens = new LensEffect({ barrel: 0.02, ca: 0.008 })
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.88, luminanceSmoothing: 0.08, radius: 0.5 })
  const film = new FilmEffect({ vignette: 0.8, grain: 0.009, exposure: 1.8 })
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX })
  return { lens, bloom, film, tone }
}

describe('LensEffect', () => {
  it('is a convolution effect that does not transform UVs', () => {
    const lens = new LensEffect()
    expect(lens.getAttributes() & EffectAttribute.CONVOLUTION).toBeTruthy()
    expect(lens.getFragmentShader()).not.toMatch(/mainUv/)
    expect(lens.getFragmentShader()).toMatch(/inputBuffer/)
  })

  it('exposes live props backed by uniforms', () => {
    const lens = new LensEffect()
    expect([lens.barrel, lens.ca]).toEqual([0.02, 0.008])
    lens.barrel = 0.05
    lens.ca = 0.01
    expect(lens.uniforms.get('barrel')?.value).toBe(0.05)
    expect(lens.uniforms.get('ca')?.value).toBe(0.01)
  })
})

describe('FilmEffect', () => {
  it('defaults to the reference grade and replaces the input colour', () => {
    const film = new FilmEffect()
    expect([film.vignette, film.grain, film.exposure, film.animated]).toEqual([0.8, 0.009, 1.8, true])
    expect(film.blendMode.blendFunction).toBe(BlendFunction.NORMAL)
    expect(film.getAttributes()).toBe(EffectAttribute.NONE)
  })

  it('freezes the grain when not animated (reduced motion)', () => {
    const film = new FilmEffect({ animated: false })
    expect(film.uniforms.get('animated')?.value).toBe(0)
    film.animated = true
    expect(film.uniforms.get('animated')?.value).toBe(1)
  })

  it('guards NaN/Inf and applies exposure before vignette and grain', () => {
    const shader = new FilmEffect().getFragmentShader()
    const guard = shader.indexOf('floatBitsToUint')
    const exposure = shader.indexOf('* exposure')
    const vignette = shader.indexOf('* vignette')
    const grain = shader.indexOf('* grain')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(exposure)
    expect(exposure).toBeLessThan(vignette)
    expect(vignette).toBeLessThan(grain)
    // r3f's mergeMode 'auto' splits passes on mainUv next to a convolution effect.
    expect(shader).not.toMatch(/mainUv/)
  })
})

describe('post chain', () => {
  it('merges Lens + Bloom + Film + AgX into one EffectPass, in that order', () => {
    const { lens, bloom, film, tone } = chain()
    // Registered in JSX order; EffectPass sorts by attributes, which must keep this order.
    const pass = new EffectPass(new PerspectiveCamera(), bloom, lens, film, tone)
    // Throws "Convolution effects cannot be merged" if a second convolution sneaks in.
    expect(() => pass.recompile()).not.toThrow()
    const material = pass.fullscreenMaterial
    expect(material).toBeInstanceOf(ShaderMaterial)
    if (!(material instanceof ShaderMaterial)) return
    // Uniforms are prefixed e<index> in execution order.
    expect(Object.keys(material.uniforms)).toEqual(
      expect.arrayContaining(['e0Barrel', 'e0Ca', 'e1Intensity', 'e2Exposure', 'e2Vignette', 'e3WhitePoint']),
    )
    const main = material.fragmentShader
    const order = ['e0MainImage(', 'e1MainImage(', 'e2MainImage(', 'e3MainImage('].map((call) => main.lastIndexOf(call))
    expect(order.every((index) => index > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('keeps tone mapping in AgX mode with exposure only in the Film effect', () => {
    const { tone, film } = chain()
    expect(tone.mode).toBe(ToneMappingMode.AGX)
    // AgX in postprocessing multiplies by renderer.toneMappingExposure, which stays 1 (Experience.tsx).
    expect(film.exposure).toBe(1.8)
  })
})
