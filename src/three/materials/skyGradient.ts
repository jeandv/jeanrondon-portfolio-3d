import { BackSide, ShaderMaterial, Uniform } from 'three'
import { CYLINDER_VERTEX, linearColor, NOISE_GLSL, SKY_LAYER } from './cityLayer'

/**
 * Night sky palette (sRGB). The sodium glow blends into a neutral dark `mid`
 * (not straight into blue) so the transition reads brown-grey, not lavender.
 */
export const SKY_COLORS = {
  zenith: '#060914',
  mid: '#0e1222',
  /** Sodium light pollution right above the skyline. */
  glow: '#3a2a20',
  /** Cloud undersides lit by the city / unlit tops. */
  cloudLow: '#2e221c',
  cloudHigh: '#0f1220',
} as const

/** How fast the glow fades with height (per unit t) and how visible the clouds are. */
export const SKY_TUNING = { glowFalloff: 22, cloudOpacity: 0.45 } as const

const SKY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform vec3 uCloudLow;
uniform vec3 uCloudHigh;
uniform float uGlowFalloff;
uniform float uCloudOpacity;
varying vec2 vST;

${NOISE_GLSL}

void main() {
  float t = vST.y;
  vec3 c = mix(uMid, uZenith, smoothstep(0.04, 0.45, t));
  // Warm dome hugging the skyline, slightly stronger toward the city centre.
  float glow = exp(-max(t + 0.02, 0.0) * uGlowFalloff) * (0.85 + 0.15 * cos(vST.x * 2.0 + 0.6));
  c = mix(c, uGlow, clamp(glow, 0.0, 1.0));

  // Faint low cloud deck: projected onto an overhead plane so it foreshortens
  // toward the horizon; slow drift; lit from below by the city.
  float deck = smoothstep(0.02, 0.08, t) * (1.0 - smoothstep(0.3, 0.5, t));
  if (deck > 0.0) {
    vec2 p = vec2(vST.x, 1.0) * (0.9 / (max(t, 0.0) + 0.06));
    p += vec2(0.02, 0.004) * uTime;
    float n = fbm4(p * vec2(1.0, 1.6));
    float cloud = smoothstep(0.52, 0.82, n) * deck;
    vec3 lit = mix(uCloudHigh, uCloudLow, exp(-max(t, 0.0) * 14.0));
    c = mix(c, lit, cloud * uCloudOpacity);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`

/** Opaque gradient sky with drifting low clouds (r = 40 cylinder). */
export function createSkyMaterial(time: Uniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    name: 'city_sky',
    uniforms: {
      uTime: time,
      uRadius: new Uniform(SKY_LAYER.radius),
      uArc: new Uniform(SKY_LAYER.arc),
      uZenith: new Uniform(linearColor(SKY_COLORS.zenith)),
      uMid: new Uniform(linearColor(SKY_COLORS.mid)),
      uGlow: new Uniform(linearColor(SKY_COLORS.glow)),
      uCloudLow: new Uniform(linearColor(SKY_COLORS.cloudLow)),
      uCloudHigh: new Uniform(linearColor(SKY_COLORS.cloudHigh)),
      uGlowFalloff: new Uniform(SKY_TUNING.glowFalloff),
      uCloudOpacity: new Uniform(SKY_TUNING.cloudOpacity),
    },
    vertexShader: CYLINDER_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
  })
}
