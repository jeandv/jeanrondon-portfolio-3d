import { AdditiveBlending, Color, PlaneGeometry, ShaderMaterial, Uniform } from 'three'
import { NOISE_GLSL } from './cityLayer'

/**
 * Coffee steam (one draw call): a vertical plane over the mug, turned to the
 * camera in the vertex shader (cylindrical billboard), with two soft noise
 * wisps rising and curling. Additive and faint: it must never bloom.
 */

/** Plume size (m) above the rim. */
export const STEAM_SIZE = { width: 0.1, height: 0.2 } as const
/** Peak radiance of the densest wisp (linear; far below the .88 bloom threshold). */
export const STEAM_PEAK = 0.075
const STEAM_COLOR = '#e8dccb'

/** The plume plane, its origin at the bottom centre (the rim). */
export function createSteamGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(STEAM_SIZE.width, STEAM_SIZE.height)
  geometry.translate(0, STEAM_SIZE.height / 2, 0)
  return geometry
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Camera right in world space (first row of the view matrix); up stays world up.
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 world = origin + right * position.x + vec3(0.0, position.y, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform vec3 uColor;
varying vec2 vUv;

${NOISE_GLSL}

float wisp(vec2 uv, float seed) {
  float y = uv.y;
  // The wisp drifts sideways more the higher it rises.
  float sway = sin(y * 5.0 - uTime * 1.1 + seed * 2.3) * 0.11 * y + (vnoise(vec2(seed, y * 2.0 - uTime * 0.4)) - 0.5) * 0.18 * y;
  float x = uv.x - 0.5 - sway;
  float width = mix(0.05, 0.2, y);
  float core = exp(-(x * x) / (width * width));
  float breakup = fbm3(vec2(uv.x * 4.0 + seed, y * 3.0 - uTime * 0.55));
  return core * smoothstep(0.35, 0.8, breakup);
}

void main() {
  // MSAA evaluates edge samples with the varyings extrapolated past the quad:
  // clamp, or pow() of a negative base turns NaN and Bloom spreads it over the frame.
  vec2 uv = clamp(vUv, 0.0, 1.0);
  float a = wisp(uv, 1.7) + 0.7 * wisp(uv + vec2(0.06, 0.0), 5.3);
  // Born at the rim, gone near the top.
  a *= smoothstep(0.0, 0.12, uv.y) * pow(max(1.0 - uv.y, 0.0), 1.6) * uAmount;
  if (!(a > 0.002)) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`

export function createSteamMaterial(time: Uniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    name: 'coffee_steam',
    uniforms: {
      uTime: time,
      uAmount: new Uniform(1),
      uColor: new Uniform(new Color(STEAM_COLOR).multiplyScalar(STEAM_PEAK)),
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

export function setSteamAmount(material: ShaderMaterial, amount: number): void {
  const uniform: unknown = material.uniforms.uAmount
  if (uniform instanceof Uniform) uniform.value = amount
}
