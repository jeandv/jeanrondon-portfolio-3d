import {
  AddEquation,
  Color,
  CustomBlending,
  DstColorFactor,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  ZeroFactor,
  type Material,
  type Object3D,
} from 'three'
import { linearColor, NOISE_GLSL } from './cityLayer'

export const GLASS_NODE = 'window_glass'

/** Plan §5.7: a faint cold tint over the view (#8fa3c7 at 6%). */
export const GLASS_STYLE = { color: '#8fa3c7', opacity: 0.06 } as const

/** Drawn last among the window layers (they use renderOrder −6…−2). */
export const GLASS_RENDER_ORDER = -1
/** Raindrops go on right after the tint, before any room transparent (renderOrder 0). */
export const DROPLETS_RENDER_ORDER = -0.5

/** Per-channel multiplier: white lerped 6% toward the glass colour (linear). */
export function glassTint(): Color {
  return new Color(1, 1, 1).lerp(new Color(GLASS_STYLE.color), GLASS_STYLE.opacity)
}

/**
 * Multiplicative tint (dst × tint). Normal blending would *add* 6% of a
 * mid-blue, which is several times the night sky's own radiance and lifts the
 * whole view into a lavender veil.
 */
export function createGlassMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    name: 'window_glass',
    color: glassTint(),
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blendDst: ZeroFactor,
  })
}

/* ------------------------------------------------------------------ */
/* Raindrops on the glass                                               */
/* ------------------------------------------------------------------ */

/**
 * Drop sizes (m) and grids. Real beads are 1–4 mm; from the desk (~2.2 m)
 * that is under a pixel, so they are drawn ~1.5× larger to read at home.
 */
export const DROPLETS = {
  /** Small dense beads: grid cell, share of cells with a bead, radius range. */
  fine: { cell: 0.022, presence: 0.3, radius: [0.0014, 0.003] },
  /** Bigger sparse beads; the largest 8% catch a stronger highlight (the rare bloom). */
  coarse: { cell: 0.05, presence: 0.24, radius: [0.003, 0.0065] },
  /** Running drops: one lane per column, a share of the lanes active, head radius, trail length. */
  runners: { column: 0.09, active: 0.4, head: [0.0045, 0.0055], trail: 0.12 },
} as const

/** Linear radiance: the street glow a drop shows (it is a lens: the bright city below, upside down). */
const DROP_GLOW = linearColor('#ffb06a').multiplyScalar(0.09)
/** The room-side highlight (lamp), ×3 on the rare big drops: the only part that may bloom. */
const DROP_SPEC = linearColor('#fff0d8').multiplyScalar(0.3)
/** Faint cool transmission through the bead. */
const DROP_TINT = linearColor(GLASS_STYLE.color).multiplyScalar(0.03)

const glsl = (value: number) => value.toFixed(5)

const DROPLET_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const { fine, coarse, runners } = DROPLETS

const DROPLET_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec2 uSize;
uniform float uVDown;
uniform float uRunning;
uniform vec3 uGlow;
uniform vec3 uSpec;
uniform vec3 uTint;
varying vec2 vUv;

${NOISE_GLSL}

// Premultiplied (rgb, alpha) of one drop: d = offset from its centre, r = radii (m), px = pixel size (m).
// glow: how much street light this drop catches; spark: highlight gain.
vec4 shade(vec2 d, vec2 r, float px, float glow, float spark) {
  vec2 n = d / r;
  float dist = length(n);
  float aa = px / min(r.x, r.y);
  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist);
  if (cover <= 0.0) return vec4(0.0);
  float rim = smoothstep(0.35, 1.0, dist * dist);
  // The bright city below shows upside down in the upper part of the bead.
  float lens = smoothstep(-0.2, 0.8, n.y) * (1.0 - 0.75 * rim);
  float spec = 1.0 - smoothstep(0.0, 0.26, length(n - vec2(-0.3, 0.45)));
  vec3 rgb = uGlow * lens * glow + uSpec * spec * spark + uTint * (1.0 - rim);
  return vec4(rgb, 0.14 + 0.46 * rim) * cover;
}

vec4 over(vec4 top, vec4 under) {
  return top + under * (1.0 - top.a);
}

// One bead per occupied cell, kept 0.3 cell away from the cell edges (radius < that).
vec4 beads(vec2 p, float cell, float presence, vec2 radius, float seed, float px) {
  vec2 id = floor(p / cell);
  if (hash12(id + seed) > presence) return vec4(0.0);
  vec2 jitter = vec2(hash12(id + seed + 17.3), hash12(id + seed + 41.9));
  float size = hash12(id + seed + 7.7);
  float r = mix(radius.x, radius.y, size * size);
  vec2 center = (id + 0.3 + 0.4 * jitter) * cell;
  float glow = 0.25 + 0.75 * hash12(id + seed + 29.1);
  float spark = size > 0.92 ? 3.0 : 0.35 + 0.65 * size;
  // Gravity: a touch taller than wide.
  return shade(p - center, vec2(r, r * 1.12), px, glow, spark);
}

// Now and then a drop lets go and runs down its lane, stick-slip, leaving a short trail.
vec4 runner(vec2 p, float px) {
  float col = floor(p.x / ${glsl(runners.column)});
  float h = hash12(vec2(col, 3.7));
  if (h > ${glsl(runners.active)}) return vec4(0.0);
  float period = 7.0 + 9.0 * hash12(vec2(col, 9.1));
  float t = mod(uTime + 40.0 * hash12(vec2(col, 5.3)), period);
  float dur = 1.6 + 1.2 * hash12(vec2(col, 2.9));
  if (t > dur + 1.2) return vec4(0.0);
  float startY = uSize.y * (0.6 + 0.35 * hash12(vec2(col, 6.1)));
  float travel = uSize.y * (0.2 + 0.3 * hash12(vec2(col, 8.3)));
  float k = clamp(t / dur, 0.0, 1.0);
  float slip = clamp(k + 0.06 * sin(k * 18.0 + h * 20.0), 0.0, 1.0);
  float headY = startY - travel * slip;
  float baseX = (col + 0.5) * ${glsl(runners.column)};
  vec2 head = vec2(baseX + 0.006 * sin(headY * 37.0 + h * 11.0), headY);
  // After the run it sits a moment, then dries out.
  float fade = 1.0 - smoothstep(dur, dur + 1.2, t);
  vec4 c = shade(p - head, vec2(${glsl(runners.head[0])}, ${glsl(runners.head[1])}), px, 1.0, 1.4) * fade;
  float above = p.y - head.y;
  float trail = min(${glsl(runners.trail)}, startY - headY);
  if (above > 0.0 && above < trail) {
    float x = baseX + 0.006 * sin(p.y * 37.0 + h * 11.0);
    float w = 0.0011;
    float line = 1.0 - smoothstep(w - px, w + px, abs(p.x - x));
    float a = line * (1.0 - above / trail) * (0.6 + 0.4 * step(0.5, fract(p.y / 0.011 + h * 3.0))) * fade;
    c = over(c, vec4(uGlow * 0.5 * a, 0.3 * a));
  }
  return c;
}

void main() {
  vec2 p = vec2(vUv.x, uVDown > 0.5 ? 1.0 - vUv.y : vUv.y) * uSize;
  float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-5);
  vec4 c = uRunning > 0.5 ? runner(p, px) : vec4(0.0);
  c = over(c, beads(p, ${glsl(coarse.cell)}, ${glsl(coarse.presence)}, vec2(${glsl(coarse.radius[0])}, ${glsl(coarse.radius[1])}), 11.0, px));
  c = over(c, beads(p, ${glsl(fine.cell)}, ${glsl(fine.presence)}, vec2(${glsl(fine.radius[0])}, ${glsl(fine.radius[1])}), 3.0, px));
  if (c.a <= 0.002) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`

/** Where the glass's UVs sit in the world: metres per UV unit, and whether v grows downward (glTF). */
export interface GlassFrame {
  readonly width: number
  readonly height: number
  readonly vDown: boolean
}

/** The UV frame of a mesh from its first triangle (world space, so node scale and quantization count). */
export function glassFrame(mesh: Mesh): GlassFrame | null {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!position || !uv || position.count < 3) return null
  const index = geometry.getIndex()
  const corners = index ? [index.getX(0), index.getX(1), index.getX(2)] : [0, 1, 2]
  mesh.updateWorldMatrix(true, false)
  const [p0, p1, p2] = corners.map((i) => new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
  const [t0, t1, t2] = corners.map((i) => new Vector2(uv.getX(i), uv.getY(i)))
  if (!p0 || !p1 || !p2 || !t0 || !t1 || !t2) return null
  const e1 = p1.clone().sub(p0)
  const e2 = p2.clone().sub(p0)
  const [du1, dv1, du2, dv2] = [t1.x - t0.x, t1.y - t0.y, t2.x - t0.x, t2.y - t0.y]
  const det = du1 * dv2 - du2 * dv1
  if (Math.abs(det) < 1e-12) return null
  // Tangent (∂P/∂u) and bitangent (∂P/∂v).
  const tangent = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det)
  const bitangent = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det)
  return { width: tangent.length(), height: bitangent.length(), vDown: bitangent.y < 0 }
}

/** Static beads plus, now and then, a drop running down with a short trail (premultiplied over the view). */
export function createDropletMaterial(time: Uniform<number>): ShaderMaterial {
  return new ShaderMaterial({
    name: 'window_droplets',
    uniforms: {
      uTime: time,
      uSize: new Uniform(new Vector2(2.4, 1.35)),
      uVDown: new Uniform(1),
      uRunning: new Uniform(1),
      uGlow: new Uniform(DROP_GLOW.clone()),
      uSpec: new Uniform(DROP_SPEC.clone()),
      uTint: new Uniform(DROP_TINT.clone()),
    },
    vertexShader: DROPLET_VERTEX,
    fragmentShader: DROPLET_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
}

/** Reduced motion: beads only, nothing runs. */
export function setDropletsRunning(material: ShaderMaterial, running: boolean): void {
  const uniform: unknown = material.uniforms.uRunning
  if (uniform instanceof Uniform) uniform.value = running ? 1 : 0
}

/**
 * Swaps the GLB's `window_glass` material for the tinted basic glass, lays
 * the raindrops over it (a second mesh sharing its geometry, one more draw
 * call) and returns a restore function (StrictMode / HMR safe). No-op
 * without the node.
 */
export function applyGlass(room: Object3D, material: Material, droplets?: ShaderMaterial): () => void {
  const glass = room.getObjectByName(GLASS_NODE)
  if (!(glass instanceof Mesh)) return () => {}
  const previous = { material: glass.material, renderOrder: glass.renderOrder }
  glass.material = material
  glass.renderOrder = GLASS_RENDER_ORDER

  let overlay: Mesh | null = null
  if (droplets) {
    const frame = glassFrame(glass)
    if (frame) {
      const size: unknown = droplets.uniforms.uSize?.value
      if (size instanceof Vector2) size.set(frame.width, frame.height)
      const vDown: unknown = droplets.uniforms.uVDown
      if (vDown instanceof Uniform) vDown.value = frame.vDown ? 1 : 0
    }
    overlay = new Mesh(glass.geometry, droplets)
    overlay.name = 'window_droplets'
    overlay.userData = { runtimeHelper: true }
    overlay.renderOrder = DROPLETS_RENDER_ORDER
    glass.add(overlay)
  }

  return () => {
    if (overlay) glass.remove(overlay)
    glass.material = previous.material
    glass.renderOrder = previous.renderOrder
  }
}
