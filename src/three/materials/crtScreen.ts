import { Color, ShaderMaterial, Vector2, type ColorRepresentation, type IUniform, type Texture } from 'three'

/**
 * CRT screen (plan §5.5): samples a CanvasScreen texture with a slight
 * bulge, scanlines, a subtle aperture-grille mask, 1–2% flicker and an edge
 * vignette. `uBoost` (1.4) pushes white text above the bloom threshold (.88):
 * the output is linear HDR and `toneMapped` is false because tone mapping
 * happens in post (M4).
 */

export interface CrtOptions {
  /** Phosphor tint multiplied into the picture. */
  readonly tint: ColorRepresentation
  /** HDR gain; 1.4 makes white exceed the bloom threshold. */
  readonly boost: number
  /** Barrel amount (0 = flat glass). */
  readonly bulge: number
  /** Scanline darkening 0..1 (faded out where lines would alias). */
  readonly scanStrength: number
  /** Aperture-grille strength 0..1 (screen space, 3 px triads). */
  readonly maskStrength: number
  /** Brightness jitter (0.015 = ±1.5%). */
  readonly flicker: number
  /** Edge darkening 0..1. */
  readonly vignette: number
  /** Phosphor glow/persistence from 4 neighbour taps (0 = off). */
  readonly glow: number
  /** Lit-phosphor floor so black is never pure black. */
  readonly black: ColorRepresentation
}

export const CRT_PRESETS = {
  /** TV: neutral, slightly blue phosphor. */
  tv: {
    tint: '#eef4ff',
    boost: 1.4,
    bulge: 0.045,
    scanStrength: 0.22,
    maskStrength: 0.08,
    flicker: 0.015,
    vignette: 0.55,
    glow: 0,
    black: '#020305',
  },
  /** PC: green phosphor with a little glow. */
  pc: {
    tint: '#e6ffe9',
    boost: 1.3,
    bulge: 0.04,
    scanStrength: 0.26,
    maskStrength: 0.06,
    flicker: 0.012,
    vignette: 0.6,
    glow: 0.35,
    black: '#010401',
  },
} as const satisfies Record<string, CrtOptions>

export interface CrtUniforms {
  [uniform: string]: IUniform
  uMap: IUniform<Texture>
  uTexel: IUniform<Vector2>
  uScanlines: IUniform<number>
  uTime: IUniform<number>
  uTint: IUniform<Color>
  uBlack: IUniform<Color>
  uBoost: IUniform<number>
  uBulge: IUniform<number>
  uScanStrength: IUniform<number>
  uMaskStrength: IUniform<number>
  uFlicker: IUniform<number>
  uVignette: IUniform<number>
  uGlow: IUniform<number>
}

const VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform float uScanlines;
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uBlack;
uniform float uBoost;
uniform float uBulge;
uniform float uScanStrength;
uniform float uMaskStrength;
uniform float uFlicker;
uniform float uVignette;
uniform float uGlow;

varying vec2 vUv;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  // Bulge: sample further out toward the edges (convex glass).
  vec2 c = vUv * 2.0 - 1.0;
  float r2 = dot(c, c);
  vec2 uv = (c * (1.0 + uBulge * r2)) * 0.5 + 0.5;
  vec2 edge = smoothstep(vec2(0.0), vec2(0.012), uv) * smoothstep(vec2(0.0), vec2(0.012), 1.0 - uv);
  float inside = edge.x * edge.y;

  vec3 color = texture2D(uMap, uv).rgb;
  if (uGlow > 0.0) {
    vec2 o = uTexel * 2.5;
    vec3 halo = texture2D(uMap, uv + vec2(o.x, 0.0)).rgb + texture2D(uMap, uv - vec2(o.x, 0.0)).rgb
      + texture2D(uMap, uv + vec2(0.0, o.y)).rgb + texture2D(uMap, uv - vec2(0.0, o.y)).rgb;
    color = max(color, halo * 0.25 * uGlow) + halo * 0.06 * uGlow;
  }

  // Scanlines (two texel rows each), faded where they would alias.
  float lines = uv.y * uScanlines;
  float aa = clamp(1.4 - fwidth(lines) * 1.6, 0.0, 1.0);
  float scan = 1.0 - uScanStrength * aa * (0.5 - 0.5 * cos(lines * 6.2831853));

  // Aperture grille in screen space (RGB triads).
  float slot = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = 1.0 - uMaskStrength * vec3(notEqual(vec3(slot), vec3(0.0, 1.0, 2.0)));

  float flicker = 1.0 + uFlicker * (hash11(floor(uTime * 24.0)) * 2.0 - 1.0);
  float vignette = 1.0 - uVignette * r2 * 0.25;

  vec3 outColor = (color * uTint * scan * mask + uBlack) * (flicker * vignette * inside * uBoost);
  gl_FragColor = vec4(outColor, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export type CrtMaterial = ShaderMaterial & { uniforms: CrtUniforms }

/** CRT material over a screen texture (sized from the texture's canvas/image). */
export function createCrtMaterial(map: Texture, options: CrtOptions, name = 'M_crt_screen'): CrtMaterial {
  const image = map.image as { width?: number; height?: number } | undefined
  const width = image?.width ?? 640
  const height = image?.height ?? 480
  const uniforms: CrtUniforms = {
    uMap: { value: map },
    uTexel: { value: new Vector2(1 / width, 1 / height) },
    uScanlines: { value: height / 2 },
    uTime: { value: 0 },
    uTint: { value: new Color(options.tint) },
    uBlack: { value: new Color(options.black) },
    uBoost: { value: options.boost },
    uBulge: { value: options.bulge },
    uScanStrength: { value: options.scanStrength },
    uMaskStrength: { value: options.maskStrength },
    uFlicker: { value: options.flicker },
    uVignette: { value: options.vignette },
    uGlow: { value: options.glow },
  }
  const material = new ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    toneMapped: false,
  })
  return Object.assign(material, { uniforms })
}

/** Per-frame clock for the flicker. */
export function setCrtTime(material: CrtMaterial, seconds: number): void {
  material.uniforms.uTime.value = seconds
}
