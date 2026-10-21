import { BackSide, Color, ShaderMaterial, Uniform, Vector2, Vector3, Vector4, type Texture } from 'three'
import { TRAIN_GLSL } from './cityTraffic'

/**
 * Night city seen through the window (plan §5.7): open cylinder segments
 * centred on `anchor_city`, facing the room (BackSide), back to front:
 * sky r=40 → far skyline r=30 → near skyline r=18 → mist r=7.
 *
 * Layer content is authored in "view" units so every radius reads at the
 * same apparent scale from the desk while still producing parallax:
 *   s = angle around the cylinder axis (rad, 0 = straight out, + = right)
 *   t = tan(elevation) = (worldY − HORIZON_Y) / radius
 *
 * Composition (home view, see windowLayers.test.ts): street-light horizon at
 * ~38% of the visible window, regular rooftops below ~60%, a few placed towers
 * above, cold sky in the upper ~40%.
 *
 * TODO(M4+): drop a CC0 night skyline (4096×1536, sky in alpha, no landmarks)
 * as `src/assets/city/city_far.webp` and pass it as `map` to the far layer.
 */

/** World height (m) of the eye-level line the city is composed around. */
export const HORIZON_Y = 1.2

/**
 * Every window layer spans 180°: from the most extreme orbit poses
 * (azimuth −1.3…1.2 rad) rays leave the window up to ~84° off-axis
 * (see windowLayers.test.ts), so 120° would show the layer edges.
 */
export const WINDOW_ARC = Math.PI

export interface CylinderLayerSpec {
  readonly radius: number
  /** Arc (rad) centred on −Z. */
  readonly arc: number
  /** Vertical extent in t units (tan elevation from HORIZON_Y). */
  readonly tBottom: number
  readonly tTop: number
  readonly radialSegments: number
  readonly renderOrder: number
}

export interface CylinderParams {
  /** World Y of the cylinder centre. */
  readonly centerY: number
  readonly height: number
  /** CylinderGeometry thetaStart / thetaLength (θ = 0 is +Z, so −Z is π). */
  readonly thetaStart: number
  readonly thetaLength: number
}

/** World Y at a given t on a layer of radius r. */
export function yAt(t: number, radius: number): number {
  return HORIZON_Y + t * radius
}

/** CylinderGeometry parameters for a layer spec. */
export function cylinderParams(spec: CylinderLayerSpec): CylinderParams {
  const bottom = yAt(spec.tBottom, spec.radius)
  const top = yAt(spec.tTop, spec.radius)
  return {
    centerY: (bottom + top) / 2,
    height: top - bottom,
    thetaStart: Math.PI - spec.arc / 2,
    thetaLength: spec.arc,
  }
}

/* ------------------------------------------------------------------ */
/* Windows                                                              */
/* ------------------------------------------------------------------ */

/** Lit pane inside one window cell (bay × floor); the rest is pier / spandrel. */
export const PANE = { x: [0.25, 0.75], y: [0.2, 0.8] } as const
/** Bay width = floor height × BAY_RATIO, so panes are 1:1.6 (w:h). */
export const BAY_RATIO = 0.75

/** Window cell (bay width rad, floor height t) for a floor height. */
export function windowGrid(floor: number): [bay: number, floor: number] {
  return [floor * BAY_RATIO, floor]
}

/** Pane height / width on screen (s and t share the same angular scale). */
export function paneAspect(floor: number): number {
  const [bay] = windowGrid(floor)
  return ((PANE.y[1] - PANE.y[0]) * floor) / ((PANE.x[1] - PANE.x[0]) * bay)
}

const PANE_AREA = (PANE.x[1] - PANE.x[0]) * (PANE.y[1] - PANE.y[0])

/* ------------------------------------------------------------------ */
/* Layer layout                                                         */
/* ------------------------------------------------------------------ */

/**
 * Render order: the sky is opaque and drawn after the room's opaque meshes
 * (renderOrder 1) so early-z leaves only the window pixels to shade. The
 * transparent layers use negative orders so they draw back to front before
 * any room transparents (renderOrder 0).
 */
export const SKY_LAYER: CylinderLayerSpec = {
  radius: 40,
  arc: WINDOW_ARC,
  tBottom: -0.3,
  tTop: 1.15,
  radialSegments: 48,
  renderOrder: 1,
}

/** Sodium haze between the street glow (`hazeLow`) and the cold upper air. */
export const HAZE_MID = '#3a2a20'

/** A placed, landmark-free tower (far layer) with a slow red beacon on top. */
export interface TowerSpec {
  /** Centre angle (rad, + = right). */
  readonly s: number
  readonly halfWidth: number
  /** Roof height above the street line (t). */
  readonly height: number
  /** Antenna mast as a fraction of the height (0 = none). */
  readonly mast: number
}

export interface StreetSpec {
  /** Row depth scale (t): row k sits at depth row·k², so rows compress toward the horizon. */
  readonly row: number
  /** Lamp spacing (rad) in the farthest row; grows with each closer row. */
  readonly spacing: number
  /** Fraction of lamp slots lit inside a cluster. */
  readonly density: number
  /** Cluster / gap frequency along the street (1/rad). */
  readonly cluster: number
  /** Bokeh disc radius (px) of a mid row. */
  readonly bokeh: number
}

export interface CarSpec {
  /** Car slot spacing (rad) in the farthest row. */
  readonly spacing: number
  /** Speed in slots per second. */
  readonly speed: number
  /** Fraction of rows that are roads. */
  readonly roads: number
}

export interface CitySpec extends CylinderLayerSpec {
  readonly seed: number
  /** t of the street line: below it the layer is opaque (streets, lamps, cars). */
  readonly ground: number
  /** Regular building height range above the street line (t). */
  readonly heights: readonly [min: number, max: number]
  /** Height distribution exponent (higher = more low buildings). */
  readonly heightCurve: number
  /** Cell width (rad); each cell holds one or two buildings. */
  readonly cell: number
  /** Floor height (t); window bays follow BAY_RATIO. */
  readonly floor: number
  /** Mean lit-window fraction before per-building clustering. */
  readonly lit: number
  /** Window brightness multiplier. */
  readonly gain: number
  /** Near-black blue facade. */
  readonly facade: string
  /** Warm sodium glow at street level / cold haze higher up. */
  readonly hazeLow: string
  readonly hazeHigh: string
  /** Distance veil toward the haze colour (0..1). */
  readonly hazeAmount: number
  /** t over which the street glow fades up the facades. */
  readonly glowHeight: number
  readonly street: StreetSpec
  readonly cars: CarSpec
  /** Adds a lower-contrast second row of buildings behind the first. */
  readonly backRow: boolean
  readonly towers: readonly TowerSpec[]
  /** An elevated rail line just above the street lights, with trains now and then (cityTraffic.ts). */
  readonly trains: boolean
}

export const MAX_TOWERS = 4

export const CITY_FAR: CitySpec = {
  radius: 30,
  arc: WINDOW_ARC,
  tBottom: -1.15,
  tTop: 0.3,
  radialSegments: 48,
  renderOrder: -6,
  seed: 11.3,
  ground: -0.02,
  heights: [0.012, 0.07],
  heightCurve: 1.8,
  cell: 0.04,
  floor: 0.0028,
  lit: 0.19,
  gain: 0.9,
  facade: '#121626',
  hazeLow: '#5a3a22',
  hazeHigh: '#14171f',
  hazeAmount: 0.35,
  glowHeight: 0.01,
  street: { row: 0.0009, spacing: 0.006, density: 0.7, cluster: 9, bokeh: 1.4 },
  cars: { spacing: 0.05, speed: 0.25, roads: 0.3 },
  backRow: true,
  // Home view sees roughly s −0.2…0.5: two towers there (the middle pane; the
  // right pane belongs to the obelisk, obelisk.ts), two revealed by orbiting.
  towers: [
    { s: -0.75, halfWidth: 0.011, height: 0.13, mast: 0.18 },
    { s: -0.06, halfWidth: 0.01, height: 0.14, mast: 0 },
    { s: 0.1, halfWidth: 0.012, height: 0.12, mast: 0.2 },
    { s: 0.95, halfWidth: 0.008, height: 0.11, mast: 0 },
  ],
  // The S-Bahn crosses the far district every 30–90 s, partly hidden by the near blocks.
  trains: true,
}

export const CITY_NEAR: CitySpec = {
  radius: 18,
  arc: WINDOW_ARC,
  tBottom: -1.25,
  tTop: 0.1,
  radialSegments: 48,
  renderOrder: -5,
  seed: 4.7,
  ground: -0.13,
  heights: [0.036, 0.125],
  heightCurve: 1.6,
  cell: 0.12,
  floor: 0.013,
  lit: 0.29,
  gain: 1,
  facade: '#0a0d16',
  hazeLow: '#5a3a22',
  hazeHigh: '#0e1119',
  hazeAmount: 0.06,
  glowHeight: 0.02,
  street: { row: 0.004, spacing: 0.03, density: 0.55, cluster: 4, bokeh: 3.2 },
  cars: { spacing: 0.12, speed: 0.2, roads: 0.4 },
  backRow: false,
  towers: [],
  trains: false,
}

/** Back row: wider cells, slightly taller and hazier buildings. */
const BACK_ROW_HEIGHT = 1.08
const BACK_ROW_CELL = 1.43

/** Regular (non-tower) rooftop heights above the street line (t): median and maximum. */
export function rooftops(spec: CitySpec): { median: number; max: number } {
  const [min, max] = spec.heights
  return {
    median: min + (max - min) * 0.5 ** spec.heightCurve,
    max: max * (spec.backRow ? BACK_ROW_HEIGHT : 1),
  }
}

/** Tallest point a city layer draws (regular rows, towers and their masts). */
export function cityContentTop(spec: CitySpec): number {
  const towers = spec.towers.map((tower) => tower.height * (1 + tower.mast))
  return spec.ground + Math.max(rooftops(spec).max, ...towers)
}

/* ------------------------------------------------------------------ */
/* Shared GLSL                                                          */
/* ------------------------------------------------------------------ */

/** Hash without sine (Dave Hoskins) + value noise / fbm. */
export const NOISE_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 hash41(float p) {
  vec4 p4 = fract(vec4(p) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum / 0.875;
}
float fbm4(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum / 0.9375;
}
`

/** Vertex shader shared by the cylinder layers: outputs vST = (s, t). */
export const CYLINDER_VERTEX = /* glsl */ `
uniform float uRadius;
uniform float uArc;
varying vec2 vST;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  // CylinderGeometry: u = 0 at thetaStart (the +X end), so s grows to the right.
  vST = vec2((0.5 - uv.x) * uArc, (world.y - ${HORIZON_Y.toFixed(3)}) / uRadius);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/** Linear colour of an sRGB hex (three's ColorManagement converts on set). */
export function linearColor(hex: string): Color {
  return new Color(hex)
}

const glslFloat = (value: number): string => value.toFixed(4)

/* ------------------------------------------------------------------ */
/* City layer material                                                  */
/* ------------------------------------------------------------------ */

const CITY_FRAGMENT = /* glsl */ `
#define MAX_TOWERS ${MAX_TOWERS}
uniform float uTime;
uniform float uSeed;
uniform float uGround;
uniform vec2 uHeights;
uniform float uHeightCurve;
uniform float uCell;
uniform vec2 uWindowGrid;
uniform float uLit;
uniform float uGain;
uniform vec3 uFacade;
uniform vec3 uHazeLow;
uniform vec3 uHazeMid;
uniform vec3 uHazeHigh;
uniform float uHazeAmount;
uniform float uGlowHeight;
uniform vec4 uStreet;
uniform float uBokeh;
uniform vec3 uCars;
uniform vec4 uTowers[MAX_TOWERS];
uniform int uTowerCount;
uniform float uContentTop;
// Lowered stretch around the obelisk: (centre s, half width, height factor); half width 0 = none.
uniform vec3 uClear;
#ifdef USE_MAP
uniform sampler2D map;
uniform float uMapArc;
uniform vec2 uMapT;
#endif
varying vec2 vST;

${NOISE_GLSL}

#ifdef TRAINS
${TRAIN_GLSL}
#endif

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 WARM = vec3(1.0, 0.5, 0.18);          // ~2700 K interiors
const vec3 COOL = vec3(0.62, 0.8, 1.0);          // fluorescent offices
const vec3 TV_BLUE = vec3(0.3, 0.45, 1.0);
const vec3 SODIUM = vec3(1.0, 0.434, 0.107);     // #ffb060
const vec3 LED = vec3(0.807, 0.871, 1.0);        // #e8f0ff
const vec3 HEADLIGHT = vec3(1.0, 0.92, 0.75);
const vec3 TAILLIGHT = vec3(1.0, 0.03, 0.015);
const vec3 BEACON = vec3(1.0, 0.04, 0.02);
const vec2 PANE_X = vec2(${glslFloat(PANE.x[0])}, ${glslFloat(PANE.x[1])});
const vec2 PANE_Y = vec2(${glslFloat(PANE.y[0])}, ${glslFloat(PANE.y[1])});
const float PANE_AREA = ${glslFloat(PANE_AREA)};

// Anti-aliased box [a, b] with half-pixel width w.
float band(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}

// Height factor of a building centred at s (lower around the obelisk, easing back over the outer 40%).
float clearing(float s) {
  if (uClear.y <= 0.0) return 1.0;
  return mix(uClear.z, 1.0, smoothstep(uClear.y * 0.6, uClear.y, abs(s - uClear.x)));
}

// Facade + windows of one building (left edge bx, id bid) → straight colour.
// Windows cluster per building and per floor; the grid fades to floor and then
// building averages as it goes sub-pixel, so it never aliases into a dot grid.
vec3 facadeColor(vec2 st, vec2 px, float bx, float bid, vec4 q, float haze) {
  float above = max(st.y - uGround, 0.0);
  float low = exp(-above / uGlowHeight);
  float mid = exp(-above / (uGlowHeight * 4.0));
  vec3 facade = uFacade * (0.8 + 0.4 * q.y) + uHazeLow * 0.6 * low;

  vec2 wc = vec2((st.x - bx) / uWindowGrid.x, above / uWindowGrid.y);
  vec2 wi = floor(wc);
  vec2 wf = wc - wi;
  vec2 wp = px / uWindowGrid;

  // ~15% of buildings nearly dark; offices (30%) light whole floors.
  float bLit = uLit * mix(0.4, 1.6, q.z) * (q.w < 0.15 ? 0.1 : 1.0);
  bool office = q.y > 0.7;
  float fh = hash12(vec2(wi.y, bid * 3.17));
  float floorOn = step(fh, bLit);
  float floorP = office ? floorOn * 0.75 : min(bLit * mix(0.3, 1.7, fh), 1.0);
  vec3 floorLamp = (office && fh < bLit * 0.7) ? COOL : WARM;

  vec3 col = mix(facade, floorLamp * (office ? 0.27 : 0.29) * uGain, floorP * PANE_AREA);
  vec3 building = mix(facade, WARM * 0.3 * uGain, bLit * PANE_AREA);
  col = mix(col, building, smoothstep(0.6, 1.2, wp.y));

  float detail = 1.0 - smoothstep(0.25, 0.5, max(wp.x, wp.y));
  if (detail > 0.0) {
    float wh = hash12(wi + bid * 7.31);
    float lit = office ? floorOn * step(wh, 0.75) : step(wh, floorP);
    float toggle = hash12(wi.yx * 1.7 + bid * 3.11);
    if (toggle < 0.03) {
      // ~3% of windows switch on/off every 4–12 s.
      float period = 4.0 + 8.0 * hash12(wi + bid + 17.0);
      lit = mod(floor(uTime / period + toggle * 33.3), 2.0);
    }
    float kind = hash12(wi * 1.37 + bid);
    vec3 lamp = office ? floorLamp : (kind > 0.93 ? COOL : WARM);
    // Most lit windows are dim (0.15–0.5).
    float level = mix(0.15, 0.5, pow(hash12(wi.yx + bid * 1.9), 1.5));
    if (office) level = mix(0.2, 0.4, fh) * mix(0.7, 1.1, wh);
    if (!office && kind < 0.02) {
      lamp = TV_BLUE;
      level *= 0.5 + 0.5 * vnoise(vec2(uTime * 6.0, wh * 91.0));
    }
    float pane = band(wf.x, PANE_X.x, PANE_X.y, wp.x * 0.5) * band(wf.y, PANE_Y.x, PANE_Y.y, wp.y * 0.5);
    float slab = band(wf.y, 0.86, 0.98, wp.y * 0.5);
    vec3 detailed = mix(facade * (1.0 + 0.5 * slab), lamp * level * uGain, pane * lit);
    col = mix(col, detailed, detail);
  }

  // Warm sodium haze at street level, cold and dark higher up.
  vec3 hazeCol = mix(uHazeHigh, mix(uHazeMid, uHazeLow, low), mid);
  return mix(col, hazeCol, haze * (0.45 + 0.55 * mid));
}

// One row of buildings → premultiplied rgb + coverage. px = pixel size in (s, t).
vec4 buildingRow(vec2 st, vec2 px, float cell, float seed, vec2 heights, float haze) {
  float u = st.x / cell;
  float ci = floor(u);
  float fx = u - ci;
  float pu = px.x / cell;
  vec4 r = hash41(ci * 1.37 + seed);
  float w = mix(0.55, 1.0, r.x);
  float x0 = (1.0 - w) * r.y;
  float x1 = x0 + w;
  float xs = mix(x0, x1, mix(0.3, 0.7, r.z));
  bool split = r.w < 0.45;
  bool second = split && fx > xs;
  float left = second ? xs : x0;
  float right = (split && !second) ? xs : x1;
  float bid = ci * 2.0 + (second ? 1.0 : 0.0) + seed * 13.0;
  vec4 q = hash41(bid * 1.618 + 0.5);
  float h = mix(heights.x, heights.y, pow(q.x, uHeightCurve)) * clearing((ci + 0.5 * (left + right)) * cell);
  float top = uGround + h;
  if (st.y > top + px.y) return vec4(0.0);

  // Edges on the cell border stay hard so neighbours join without a seam.
  float l = left < 0.002 ? -1.0 : left;
  float rr = right > 0.998 ? 2.0 : right;
  float hp = pu * 0.5;
  bool setback = q.y < 0.35 && h > mix(heights.x, heights.y, 0.3);
  float bodyTop = setback ? uGround + h * 0.8 : top;
  float cover = band(fx, l, rr, hp) * (1.0 - smoothstep(bodyTop - px.y * 0.5, bodyTop + px.y * 0.5, st.y));
  if (setback) {
    float inset = (right - left) * 0.2;
    float crown = band(fx, left + inset, right - inset, hp);
    cover = max(cover, crown * (1.0 - smoothstep(top - px.y * 0.5, top + px.y * 0.5, st.y)));
  }
  if (cover <= 0.0) return vec4(0.0);
  return vec4(facadeColor(st, px, (ci + left) * cell, bid, q, haze) * cover, cover);
}

// A placed tower T = (centre s, half width, height, mast fraction), with a
// slow (~1 Hz) red aviation beacon on its highest point.
vec4 tower(vec2 st, vec2 px, vec4 T, float index, float haze) {
  float dx = st.x - T.x;
  float top = uGround + T.z;
  float tip = top + T.z * T.w;
  if (abs(dx) > T.y + px.x * 8.0 || st.y > tip + px.y * 8.0) return vec4(0.0);
  float bid = 1000.0 + index * 7.0 + uSeed;
  vec4 q = hash41(bid * 1.618 + 0.5);
  float hp = px.x * 0.5;
  float shoulder = top - T.z * 0.15;
  float cover = band(dx, -T.y, T.y, hp) * (1.0 - smoothstep(shoulder - px.y * 0.5, shoulder + px.y * 0.5, st.y));
  float crown = band(dx, -T.y * 0.65, T.y * 0.65, hp) * (1.0 - smoothstep(top - px.y * 0.5, top + px.y * 0.5, st.y));
  cover = max(cover, crown);
  if (T.w > 0.0) {
    float line = max(0.0, 1.0 - abs(dx) / px.x);
    float span = step(top - px.y, st.y) * (1.0 - smoothstep(tip - px.y, tip, st.y));
    cover = max(cover, line * span * 0.8);
  }
  vec2 d = vec2(dx / px.x, (st.y - tip - px.y) / px.y);
  float phase = fract(uTime + q.y);
  float blink = smoothstep(0.0, 0.1, phase) * (1.0 - smoothstep(0.45, 0.6, phase));
  float beacon = exp(-dot(d, d) * 0.18) * blink;
  if (cover <= 0.0 && beacon <= 0.001) return vec4(0.0);
  vec3 col = cover > 0.0 ? facadeColor(st, px, T.x - T.y, bid, q, haze) : vec3(0.0);
  return vec4(col * cover + BEACON * 3.5 * beacon, max(cover, min(beacon, 1.0)));
}

// Below the street line: dark ground, sodium glow, perspective rows of
// out-of-focus lamps in clusters and gaps, and slow car lights on a few roads.
vec3 streetLevel(vec2 st, vec2 px) {
  float v = uGround - st.y;
  // Glow varies along the street (busier districts brighter) instead of a flat band.
  float district = 0.45 + 0.55 * vnoise(vec2(st.x * 7.0 + uSeed, 0.5));
  vec3 c = uFacade * 0.4 + uHazeLow * district * (0.06 + 1.1 * exp(-v / uGlowHeight));
  float k = sqrt(v / uStreet.x);
  float ki = floor(k);
  float kf = k - ki;
  float rowPx = 2.0 * uStreet.x * max(k, 0.5) / px.y;

  float spacing = uStreet.y * (1.0 + ki * 0.5);
  float offset = hash11(ki + uSeed) * 10.0;
  float u = st.x / spacing + offset;
  float ui = floor(u);
  vec4 r = hash41(ui * 1.31 + ki * 17.7 + uSeed);
  float cluster = smoothstep(0.3, 0.7, vnoise(vec2((ui + 0.5 - offset) * spacing * uStreet.w, ki * 0.71 + uSeed)));
  vec2 cellPx = vec2(spacing / px.x, rowPx);
  vec2 d = vec2((u - ui - (0.3 + 0.4 * r.y)) * cellPx.x, (kf - (0.3 + 0.4 * r.z)) * cellPx.y);
  float radius = min(uBokeh * mix(0.75, 1.25, r.w) * (0.6 + 0.06 * min(ki, 10.0)), 0.3 * min(cellPx.x, cellPx.y));
  // Soft bokeh discs; sub-pixel lamps dissolve into the glow.
  float disc = (1.0 - smoothstep(radius * 0.5, radius, length(d))) * smoothstep(0.5, 1.0, radius);
  float on = step(r.x, uStreet.z * cluster);
  bool led = r.z > 0.85;
  float bright = fract(r.x * 13.7 + r.w * 3.1);
  float level = (bright > 0.92 ? 2.2 : mix(0.35, 0.9, bright)) * (led ? 0.7 : 1.0);
  c += (led ? LED : SODIUM) * disc * on * level;

  // Roads: two lanes of slow dashes (headlights one way, tail lights the other).
  float road = step(hash11(ki * 3.1 + uSeed + 5.0), uCars.z) * smoothstep(3.0, 6.0, rowPx);
  if (road > 0.0) {
    float lane = step(0.5, kf);
    float laneY = mix(0.38, 0.62, lane);
    float carSpacing = uCars.x * (1.0 + ki * 0.5);
    float cu = st.x / carSpacing + (lane * 2.0 - 1.0) * uTime * uCars.y + lane * 0.37 + hash11(ki) * 5.0;
    float cid = floor(cu);
    float hasCar = step(hash11(cid * 1.7 + ki + lane * 9.0), 0.45);
    float dash = band(cu - cid, 0.2, 0.26, px.x / carSpacing * 0.5);
    float dy = (kf - laneY) * rowPx;
    float thick = exp(-dy * dy * 0.8);
    c += mix(HEADLIGHT * 0.6, TAILLIGHT * 1.5, lane) * dash * thick * hasCar * road;
  }
  return c;
}

void main() {
  vec2 st = vST;
  vec2 px = max(fwidth(st), vec2(1e-6));
  vec4 c;
#ifdef USE_MAP
  vec2 muv = vec2(0.5 + st.x / uMapArc, (st.y - uMapT.x) / (uMapT.y - uMapT.x));
  if (muv.x < 0.0 || muv.x > 1.0 || muv.y < 0.0 || muv.y > 1.0) discard;
  c = texture2D(map, muv);
  c.rgb *= c.a;
#else
  if (st.y < uGround) {
    c = vec4(streetLevel(st, px), 1.0);
  } else {
    // Early-out: open sky above anything this layer can draw.
    if (st.y > uContentTop + px.y * 8.0) discard;
    c = buildingRow(st, px, uCell, uSeed, uHeights, uHazeAmount);
    for (int i = 0; i < MAX_TOWERS; i++) {
      if (i >= uTowerCount || c.a >= 0.999) break;
      c += tower(st, px, uTowers[i], float(i), uHazeAmount) * (1.0 - c.a);
    }
#ifdef BACK_ROW
    if (c.a < 0.999) {
      vec4 back = buildingRow(st, px, uCell * ${BACK_ROW_CELL.toFixed(2)}, uSeed + 3.7, uHeights * ${BACK_ROW_HEIGHT.toFixed(2)},
        min(1.0, uHazeAmount * 1.6 + 0.1));
      c += back * (1.0 - c.a);
    }
#endif
#ifdef TRAINS
    // The elevated line runs in front of this layer's buildings (the near layer still covers it).
    vec4 rail = trains(st, px, uGround, uTime);
    c = rail + c * (1.0 - rail.a);
#endif
  }
#endif
  if (c.a < 0.002 && dot(c.rgb, LUMA) < 0.0005) discard;
  // Push the brightest lights over the bloom threshold; everything else stays dark.
  c.rgb *= 1.0 + 2.5 * smoothstep(0.75, 1.0, dot(c.rgb, LUMA));
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`

export interface CityLayerOptions {
  readonly spec: CitySpec
  /** Shared animation clock (seconds, already scaled for reduced motion). */
  readonly time: Uniform<number>
  /** Optional photo layer (sRGB, sky in alpha) instead of the procedural city. */
  readonly map?: Texture
  /** Arc (rad) and t range the photo covers. */
  readonly mapArc?: number
  readonly mapT?: readonly [bottom: number, top: number]
}

function towerUniform(towers: readonly TowerSpec[]): Vector4[] {
  return Array.from({ length: MAX_TOWERS }, (_, i) => {
    const tower = towers[i]
    return tower ? new Vector4(tower.s, tower.halfWidth, tower.height, tower.mast) : new Vector4()
  })
}

/** Procedural night skyline (or a photo `map`) on an open cylinder, premultiplied alpha. */
export function createCityLayerMaterial({ spec, time, map, mapArc = 2.2, mapT = [-0.3, 0.52] }: CityLayerOptions): ShaderMaterial {
  const defines: Record<string, string> = {}
  if (map) defines.USE_MAP = ''
  if (spec.backRow) defines.BACK_ROW = ''
  if (spec.trains && !map) defines.TRAINS = ''
  const { street, cars } = spec
  return new ShaderMaterial({
    name: `city_r${spec.radius}`,
    defines,
    uniforms: {
      uTime: time,
      uRadius: new Uniform(spec.radius),
      uArc: new Uniform(spec.arc),
      uSeed: new Uniform(spec.seed),
      uGround: new Uniform(spec.ground),
      uHeights: new Uniform(new Vector2(...spec.heights)),
      uHeightCurve: new Uniform(spec.heightCurve),
      uCell: new Uniform(spec.cell),
      uWindowGrid: new Uniform(new Vector2(...windowGrid(spec.floor))),
      uLit: new Uniform(spec.lit),
      uGain: new Uniform(spec.gain),
      uFacade: new Uniform(linearColor(spec.facade)),
      uHazeLow: new Uniform(linearColor(spec.hazeLow)),
      uHazeMid: new Uniform(linearColor(HAZE_MID)),
      uHazeHigh: new Uniform(linearColor(spec.hazeHigh)),
      uHazeAmount: new Uniform(spec.hazeAmount),
      uGlowHeight: new Uniform(spec.glowHeight),
      uStreet: new Uniform(new Vector4(street.row, street.spacing, street.density, street.cluster)),
      uBokeh: new Uniform(street.bokeh),
      uCars: new Uniform(new Vector3(cars.spacing, cars.speed, cars.roads)),
      uTowers: new Uniform(towerUniform(spec.towers)),
      uTowerCount: new Uniform(Math.min(spec.towers.length, MAX_TOWERS)),
      uContentTop: new Uniform(cityContentTop(spec)),
      uClear: new Uniform(new Vector3(0, 0, 1)),
      map: new Uniform(map ?? null),
      uMapArc: new Uniform(mapArc),
      uMapT: new Uniform(new Vector2(...mapT)),
    },
    vertexShader: CYLINDER_VERTEX,
    fragmentShader: CITY_FRAGMENT,
    side: BackSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  })
}
