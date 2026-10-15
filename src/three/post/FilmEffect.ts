import { BlendFunction, Effect } from 'postprocessing'
import { Uniform } from 'three'

/**
 * Film half of the reference "Grade" (plan §5.8), on the linear HDR buffer
 * right before tone mapping: NaN/Inf guard → exposure → vignette → grain that
 * is stronger in the shadows. Grain animates at 24 fps unless `animated` is
 * off (reduced motion), then it is a static pattern.
 *
 * Exposure lives here, not on the renderer: the composer forces
 * NoToneMapping and ToneMappingEffect's AgX multiplies by
 * renderer.toneMappingExposure, which therefore must stay 1.
 */
const FRAGMENT = /* glsl */ `
uniform float vignette;
uniform float grain;
uniform float exposure;
uniform float animated;

float filmHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  // Bit test instead of isnan(): survives compilers that fold NaN checks away.
  uvec3 bits = floatBitsToUint(c) & 0x7f800000u;
  if (any(equal(bits, uvec3(0x7f800000u)))) c = vec3(0.0);
  c = max(c, vec3(0.0)) * exposure;
  vec2 e = uv - 0.5;
  c *= 1.0 - dot(e, e) * vignette;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float frame = mod(floor(time * 24.0), 1024.0) * animated;
  float n = filmHash(floor(uv * resolution) + frame * vec2(17.13, 41.71)) - 0.5;
  c += n * grain * (1.0 - clamp(luma, 0.0, 1.0));
  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}
`

export interface FilmEffectOptions {
  /** Vignette: c *= 1 − r²·vignette (reference .8). */
  readonly vignette?: number
  /** Grain amplitude in linear units, scaled by (1 − luma) (reference .009). */
  readonly grain?: number
  /** Linear exposure multiplier applied before tone mapping (reference 1.8). */
  readonly exposure?: number
  /** Animated grain; false (reduced motion) freezes the pattern. */
  readonly animated?: boolean
  readonly blendFunction?: BlendFunction
}

export class FilmEffect extends Effect {
  private readonly vignetteUniform: Uniform<number>
  private readonly grainUniform: Uniform<number>
  private readonly exposureUniform: Uniform<number>
  private readonly animatedUniform: Uniform<number>

  constructor({
    vignette = 0.8,
    grain = 0.009,
    exposure = 1.8,
    animated = true,
    blendFunction = BlendFunction.NORMAL,
  }: FilmEffectOptions = {}) {
    const uniforms = {
      vignette: new Uniform(vignette),
      grain: new Uniform(grain),
      exposure: new Uniform(exposure),
      animated: new Uniform(animated ? 1 : 0),
    }
    super('FilmEffect', FRAGMENT, { blendFunction, uniforms: new Map<string, Uniform>(Object.entries(uniforms)) })
    this.vignetteUniform = uniforms.vignette
    this.grainUniform = uniforms.grain
    this.exposureUniform = uniforms.exposure
    this.animatedUniform = uniforms.animated
  }

  get vignette(): number {
    return this.vignetteUniform.value
  }

  set vignette(value: number) {
    this.vignetteUniform.value = value
  }

  get grain(): number {
    return this.grainUniform.value
  }

  set grain(value: number) {
    this.grainUniform.value = value
  }

  get exposure(): number {
    return this.exposureUniform.value
  }

  set exposure(value: number) {
    this.exposureUniform.value = value
  }

  get animated(): boolean {
    return this.animatedUniform.value > 0
  }

  set animated(value: boolean) {
    this.animatedUniform.value = value ? 1 : 0
  }
}
