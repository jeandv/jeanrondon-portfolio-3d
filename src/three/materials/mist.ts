import { BackSide, ShaderMaterial, Uniform } from 'three'
import { CYLINDER_VERTEX, linearColor, NOISE_GLSL, WINDOW_ARC, type CylinderLayerSpec } from './cityLayer'

/**
 * Low mist hugging the city ~8 m beyond the glass. A cylinder segment
 * (instead of a flat plane) so no edge can show at grazing orbit angles.
 */
export const MIST_LAYER: CylinderLayerSpec = {
  radius: 7,
  arc: WINDOW_ARC,
  tBottom: -1.4,
  tTop: 1.35,
  radialSegments: 32,
  renderOrder: -4,
}

export const MIST_STYLE = {
  /** Haze lit by sodium street lights (low) / neutral veil (high), sRGB. */
  low: '#5a3a22',
  high: '#14171f',
  opacity: 0.1,
  /** t (on the r=7 cylinder) where the mist has faded out; keeps it off the sky. */
  ceiling: 0.04,
} as const

const MIST_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform float uOpacity;
uniform float uCeiling;
varying vec2 vST;

${NOISE_GLSL}

void main() {
  float t = vST.y;
  // Denser near the street, gone above the skyline.
  float hug = 1.0 - smoothstep(-0.06, uCeiling, t);
  if (hug <= 0.0) discard;
  vec2 p = vec2(vST.x * 3.0 + uTime * 0.012, t * 9.0 - uTime * 0.003);
  float n = fbm3(p);
  float a = (0.3 + 0.7 * smoothstep(0.35, 0.8, n)) * hug * uOpacity;
  vec3 col = mix(uHigh, uLow, 1.0 - smoothstep(-0.1, uCeiling, t));
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`

/** Subtle drifting veil (premultiplied normal blending). */
export function createMistMaterial(time: Uniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    name: 'city_mist',
    uniforms: {
      uTime: time,
      uRadius: new Uniform(MIST_LAYER.radius),
      uArc: new Uniform(MIST_LAYER.arc),
      uLow: new Uniform(linearColor(MIST_STYLE.low)),
      uHigh: new Uniform(linearColor(MIST_STYLE.high)),
      uOpacity: new Uniform(MIST_STYLE.opacity),
      uCeiling: new Uniform(MIST_STYLE.ceiling),
    },
    vertexShader: CYLINDER_VERTEX,
    fragmentShader: MIST_FRAGMENT,
    side: BackSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
}
