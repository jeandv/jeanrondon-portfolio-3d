import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Uniform } from 'three'

/**
 * Lens half of the reference "Grade" (plan §5.8): slight barrel distortion +
 * lateral chromatic aberration growing with r². It re-samples the input at
 * other UVs, so it is a CONVOLUTION effect: it may share its EffectPass with
 * plain colour effects (Bloom, Film, ToneMapping) but must come first there,
 * which EffectPass guarantees by sorting on attributes.
 */
const FRAGMENT = /* glsl */ `
uniform float barrel;
uniform float ca;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 e = uv - 0.5;
  float r2 = dot(e, e);
  vec2 d = e * (1.0 - barrel * r2);
  float k = ca * r2;
  float red = texture2D(inputBuffer, 0.5 + d * (1.0 + k)).r;
  vec4 green = texture2D(inputBuffer, 0.5 + d);
  float blue = texture2D(inputBuffer, 0.5 + d * (1.0 - k)).b;
  outputColor = vec4(red, green.g, blue, green.a);
}
`

export interface LensEffectOptions {
  /** Barrel distortion strength (reference .02). */
  readonly barrel?: number
  /** Lateral chromatic aberration at the corners (reference .008). */
  readonly ca?: number
  readonly blendFunction?: BlendFunction
}

export class LensEffect extends Effect {
  private readonly barrelUniform: Uniform<number>
  private readonly caUniform: Uniform<number>

  constructor({ barrel = 0.02, ca = 0.008, blendFunction = BlendFunction.NORMAL }: LensEffectOptions = {}) {
    const barrelUniform = new Uniform(barrel)
    const caUniform = new Uniform(ca)
    super('LensEffect', FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction,
      uniforms: new Map<string, Uniform>([
        ['barrel', barrelUniform],
        ['ca', caUniform],
      ]),
    })
    this.barrelUniform = barrelUniform
    this.caUniform = caUniform
  }

  get barrel(): number {
    return this.barrelUniform.value
  }

  set barrel(value: number) {
    this.barrelUniform.value = value
  }

  get ca(): number {
    return this.caUniform.value
  }

  set ca(value: number) {
    this.caUniform.value = value
  }
}
