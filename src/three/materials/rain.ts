import { AdditiveBlending, ShaderMaterial, Uniform } from 'three'
import { linearColor, NOISE_GLSL } from './cityLayer'

/** Plan §5.7: wind .08 rad, colour #9fb4d9, additive. */
export const RAIN_WIND_ANGLE = 0.08
export const RAIN_COLOR = '#9fb4d9'

/** prefers-reduced-motion slows every window animation (rain, clouds, mist) to 0.4×. */
export const REDUCED_MOTION_SPEED = 0.4

/** The shared clock wraps to keep float precision (rain offsets are ~speed·time). */
export const MOTION_TIME_WRAP = 3600

/** Advances the window clock by `delta` seconds, scaled for reduced motion and wrapped. */
export function advanceMotionTime(time: number, delta: number, reducedMotion: boolean): number {
  const step = Math.max(0, delta) * (reducedMotion ? REDUCED_MOTION_SPEED : 1)
  return (time + step) % MOTION_TIME_WRAP
}

export interface RainPlaneSpec {
  /** Distance (m) beyond the glass. */
  readonly distance: number
  /** Plane size (m) and centre offset from the glass centre (x, y). */
  readonly size: readonly [width: number, height: number]
  readonly offset: readonly [x: number, y: number]
  readonly opacity: number
  /** Column width (m): one lane of drops per column. */
  readonly column: number
  /** Mean streak length (m) and fall speed (m/s). */
  readonly length: number
  readonly speed: number
  /** Streak width (m); never thinner than a pixel on screen. */
  readonly width: number
  /** Fraction of active columns. */
  readonly density: number
  readonly seed: number
  readonly renderOrder: number
}

/**
 * Two planes ~1 m and ~5 m beyond the glass, sized to cover every ray that can
 * leave the window inside the orbit limits (checked in windowLayers.test.ts).
 */
export const RAIN_PLANES: readonly RainPlaneSpec[] = [
  {
    distance: 5,
    size: [37, 25],
    offset: [-0.75, 2.2],
    opacity: 0.1,
    column: 0.08,
    length: 0.34,
    speed: 6.5,
    width: 0.006,
    density: 0.5,
    seed: 3.1,
    renderOrder: -3,
  },
  {
    distance: 1,
    size: [10, 6.6],
    offset: [-0.15, 0.45],
    opacity: 0.18,
    column: 0.032,
    length: 0.15,
    speed: 5,
    width: 0.0022,
    density: 0.4,
    seed: 1.7,
    renderOrder: -2,
  },
]

const RAIN_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const RAIN_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uColumn;
uniform float uLength;
uniform float uSpeed;
uniform float uWidth;
uniform float uDensity;
uniform float uWind;
uniform float uSeed;
varying vec2 vPos;

${NOISE_GLSL}

// One set of falling streaks; pw = pixel width in metres (from fwidth).
float streaks(vec2 p, float column, float seed, float pw) {
  float x = p.x / column;
  float col = floor(x);
  float r1 = hash11(col * 0.731 + seed);
  if (r1 > uDensity) return 0.0;
  float r2 = hash11(col * 1.317 + seed + 7.0);
  float r3 = hash11(col * 2.113 + seed + 13.0);
  float speed = uSpeed * (0.75 + 0.5 * r2);
  float len = uLength * (0.6 + 0.8 * r3);
  float period = len * (2.5 + 5.0 * r1 / uDensity);
  // k = distance above the streak head; the pattern scrolls down over time.
  float k = mod(p.y + uTime * speed + r2 * 50.0, period);
  float tail = 1.0 - k / len;
  if (tail <= 0.0) return 0.0;
  float dx = (x - col - (0.25 + 0.5 * r3)) * column;
  float hw = max(uWidth * 0.5, pw);
  float lateral = max(0.0, 1.0 - abs(dx) / hw) * (uWidth * 0.5 / hw);
  return lateral * tail * tail;
}

void main() {
  // Shear so streaks lean with the wind (and drift sideways as they fall).
  vec2 p = vec2(vPos.x + vPos.y * uWind, vPos.y);
  float pw = max(fwidth(p.x), 1e-5);
  float a = streaks(p, uColumn, uSeed, pw) + 0.7 * streaks(p + vec2(0.37, 0.0), uColumn * 0.71, uSeed + 31.0, pw);
  a *= uOpacity;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(uColor, min(a, 1.0));
  #include <colorspace_fragment>
}
`

/** Additive shader rain on a plane (depthWrite off, drawn after the city layers). */
export function createRainMaterial(spec: RainPlaneSpec, time: Uniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    name: `rain_${spec.distance}m`,
    uniforms: {
      uTime: time,
      uColor: new Uniform(linearColor(RAIN_COLOR)),
      uOpacity: new Uniform(spec.opacity),
      uColumn: new Uniform(spec.column),
      uLength: new Uniform(spec.length),
      uSpeed: new Uniform(spec.speed),
      uWidth: new Uniform(spec.width),
      uDensity: new Uniform(spec.density),
      uWind: new Uniform(Math.tan(RAIN_WIND_ANGLE)),
      uSeed: new Uniform(spec.seed),
    },
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
}
