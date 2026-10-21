/**
 * Trains and planes in the window (pure timing + the GLSL that draws them).
 * Both are deterministic functions of the shared window clock (seconds,
 * wrapping every MOTION_TIME_WRAP = 3600 s): no JS state per frame, no extra
 * draw calls (the trains live in the far skyline's shader, the planes in the
 * sky's). Time is cut into slots; each slot may hold one departure at a
 * seeded offset, so the hash of the slot fixes everything about it.
 * Self-contained (no imports), so scripts can load it too.
 */

/** The window clock wraps here (mirror of MOTION_TIME_WRAP in rain.ts); periods divide it. */
export const TRAFFIC_WRAP = 3600

/** An S-Bahn on an elevated line just above the far street lights (far skyline, r = 30). */
export const TRAIN = {
  /** One departure per slot (s), at a seeded offset in its first `spread` seconds: 30–90 s apart. */
  period: 60,
  spread: 30,
  /** Angular speed (rad/s; ~15 s across the home view's window). */
  speed: 0.045,
  /** It runs from one end of the far layer's arc to the other (s, rad). */
  from: -1.65,
  to: 1.65,
  /** Track height above the far street line and car height (t units). */
  track: 0.0034,
  height: 0.0042,
  cars: 6,
  /** Car length and coupling gap (rad). */
  car: 0.024,
  gap: 0.0016,
} as const

/** Planes crossing the sky with nav lights and strobes (sky, r = 40). */
export const PLANE = {
  period: 45,
  spread: 10,
  /** Share of slots with a plane: ~1 per minute, never more than 2. */
  chance: 0.75,
  speed: 0.04,
  from: -1.5,
  to: 1.5,
  /** Altitude band (t on the sky cylinder): above the towers, below the top of the home frame. */
  low: 0.118,
  high: 0.168,
  /** Gentle climb or descent (t per rad). */
  slope: 0.012,
} as const

export const TRAIN_LENGTH = TRAIN.cars * TRAIN.car + (TRAIN.cars - 1) * TRAIN.gap
export const TRAIN_SECONDS = (TRAIN.to - TRAIN.from + TRAIN_LENGTH) / TRAIN.speed
export const PLANE_SECONDS = (PLANE.to - PLANE.from) / PLANE.speed

const fract = (x: number) => x - Math.floor(x)

/** Mirror of the shaders' hash11 (Dave Hoskins, "hash without sine"). */
export function hash11(value: number): number {
  let p = fract(value * 0.1031)
  p *= p + 33.33
  p *= p + p
  return fract(p)
}

/** Slot key: the slot index modulo the slots in one clock wrap (continuous across the wrap). */
function slotKey(slot: number, period: number): number {
  const slots = TRAFFIC_WRAP / period
  return ((slot % slots) + slots) % slots
}

export interface Crossing {
  /** Seconds since it set off (0 … its crossing time). */
  readonly elapsed: number
  /** +1 left → right, −1 right → left. */
  readonly dir: 1 | -1
  /** Leading end / position along the arc (s, rad). */
  readonly s: number
  /** Planes: altitude (t). Trains: 0. */
  readonly t: number
}

/** The train of `slot` at `time`, or null when it is not on the line. */
export function trainOf(slot: number, time: number): Crossing | null {
  const key = slotKey(slot, TRAIN.period)
  const depart = slot * TRAIN.period + hash11(key * 1.37 + 3.1) * TRAIN.spread
  const elapsed = time - depart
  if (elapsed < 0 || elapsed > TRAIN_SECONDS) return null
  const dir = hash11(key * 2.91 + 7.7) < 0.5 ? 1 : -1
  const s = dir > 0 ? TRAIN.from + TRAIN.speed * elapsed : TRAIN.to - TRAIN.speed * elapsed
  return { elapsed, dir, s, t: 0 }
}

/** The plane of `slot` at `time`, or null (none in this slot, or not in the sky now). */
export function planeOf(slot: number, time: number): Crossing | null {
  const key = slotKey(slot, PLANE.period)
  if (hash11(key * 1.91 + 5.3) > PLANE.chance) return null
  const depart = slot * PLANE.period + hash11(key * 2.37 + 1.9) * PLANE.spread
  const elapsed = time - depart
  if (elapsed < 0 || elapsed > PLANE_SECONDS) return null
  const dir = hash11(key * 3.17 + 8.3) < 0.5 ? 1 : -1
  const s = dir > 0 ? PLANE.from + PLANE.speed * elapsed : PLANE.to - PLANE.speed * elapsed
  const altitude = PLANE.low + (PLANE.high - PLANE.low) * hash11(key * 4.73 + 2.2)
  const climb = (hash11(key * 5.11 + 0.7) - 0.5) * 2 * PLANE.slope
  return { elapsed, dir, s, t: altitude + climb * s }
}

/** Everything crossing at `time`: the current slot and the one before (a crossing never spans more). */
export function trafficAt(time: number): { trains: Crossing[]; planes: Crossing[] } {
  const trains: Crossing[] = []
  const planes: Crossing[] = []
  const trainSlot = Math.floor(time / TRAIN.period)
  const planeSlot = Math.floor(time / PLANE.period)
  for (const slot of [trainSlot - 1, trainSlot]) {
    const train = trainOf(slot, time)
    if (train) trains.push(train)
  }
  for (const slot of [planeSlot - 1, planeSlot]) {
    const plane = planeOf(slot, time)
    if (plane) planes.push(plane)
  }
  return { trains, planes }
}

const f = (value: number) => value.toFixed(5)

/**
 * GLSL: `vec4 trains(vec2 st, vec2 px, float ground, float time)` for the far
 * skyline (premultiplied rgb + coverage over the buildings), after NOISE_GLSL.
 * A string of cars with warm lit windows on a thin dark viaduct, a headlight
 * with its glow ahead on the track, a red tail light.
 */
export const TRAIN_GLSL = /* glsl */ `
const vec3 TRAIN_WINDOW = vec3(1.0, 0.82, 0.55);
const vec3 TRAIN_BODY = vec3(0.035, 0.04, 0.055);
const vec3 TRAIN_HEAD = vec3(1.0, 0.95, 0.85);
const vec3 TRAIN_TAIL = vec3(1.0, 0.05, 0.03);

float trainBand(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}

// One train (slot) → premultiplied colour + coverage (its lamps add light, coverage 0).
vec4 trainSlot(vec2 st, vec2 px, float ground, float time, float slot) {
  float key = mod(slot, ${f(TRAFFIC_WRAP / TRAIN.period)});
  float depart = slot * ${f(TRAIN.period)} + hash11(key * 1.37 + 3.1) * ${f(TRAIN.spread)};
  float e = time - depart;
  if (e < 0.0 || e > ${f(TRAIN_SECONDS)}) return vec4(0.0);
  float dir = hash11(key * 2.91 + 7.7) < 0.5 ? 1.0 : -1.0;
  float head = dir > 0.0 ? ${f(TRAIN.from)} + ${f(TRAIN.speed)} * e : ${f(TRAIN.to)} - ${f(TRAIN.speed)} * e;
  // u: distance behind the head along the train (rad).
  float u = (head - st.x) * dir;
  if (u < -0.05 || u > ${f(TRAIN_LENGTH)} + px.x * 8.0) return vec4(0.0);
  float y = st.y - ground - ${f(TRAIN.track)};
  float lampY = (y - ${f(TRAIN.height * 0.3)}) / px.y;
  // The headlight, its beam along the track ahead, and the red tail light.
  vec2 lamp = vec2(u / px.x, lampY);
  vec3 light = TRAIN_HEAD * 2.6 * exp(-dot(lamp, lamp) * 0.45);
  if (u < 0.0) {
    float across = y / max(px.y * 1.5, 1e-6);
    light += TRAIN_HEAD * 0.35 * exp(u / 0.012) * exp(-across * across);
  }
  vec2 tail = vec2((u - ${f(TRAIN_LENGTH)}) / px.x, lampY);
  light += TRAIN_TAIL * 1.6 * exp(-dot(tail, tail) * 0.6);
  float body = trainBand(y, 0.0, ${f(TRAIN.height)}, px.y * 0.5) * trainBand(u, 0.0, ${f(TRAIN_LENGTH)}, px.x * 0.5);
  if (body <= 0.0) return vec4(light, 0.0);
  float pitch = ${f(TRAIN.car + TRAIN.gap)};
  float carU = mod(u, pitch);
  float inCar = trainBand(carU, 0.0, ${f(TRAIN.car)}, px.x * 0.5);
  // Lit windows: panes along each car, blending into one glowing strip once they go sub-pixel.
  float pane = trainBand(mod(carU, 0.0026), 0.0004, 0.0021, px.x * 0.5);
  pane = mix(pane, 0.65, smoothstep(0.4, 0.8, px.x / 0.0026));
  float glass = trainBand(y, ${f(TRAIN.height * 0.35)}, ${f(TRAIN.height * 0.8)}, px.y * 0.5) * pane * inCar;
  float flicker = 0.85 + 0.15 * hash11(floor(u / pitch) + key * 3.0);
  vec3 col = mix(TRAIN_BODY, TRAIN_WINDOW * 0.85 * flicker, glass);
  return vec4(col * body + light, body);
}

vec4 trains(vec2 st, vec2 px, float ground, float time) {
  // Thin dark viaduct deck under the line, all along the arc.
  float deckY = ground + ${f(TRAIN.track)} - px.y * 0.6;
  float deck = trainBand(st.y, deckY - px.y * 0.5, deckY + px.y * 0.5, px.y * 0.35) * 0.7;
  vec4 c = vec4(TRAIN_BODY * deck, deck);
  if (abs(st.y - ground - ${f(TRAIN.track + TRAIN.height / 2)}) > ${f(TRAIN.height)} + px.y * 6.0) return c;
  float slot = floor(time / ${f(TRAIN.period)});
  vec4 a = trainSlot(st, px, ground, time, slot);
  vec4 b = trainSlot(st, px, ground, time, slot - 1.0);
  vec4 t = a + b * (1.0 - a.a);
  return t + c * (1.0 - t.a);
}
`

/**
 * GLSL: `vec3 planes(vec2 st, vec2 px, float time)` for the sky: additive
 * nav lights (red port / green starboard), a double white strobe and a red
 * belly beacon per plane, after NOISE_GLSL.
 */
export const PLANE_GLSL = /* glsl */ `
const vec3 NAV_RED = vec3(1.0, 0.08, 0.05);
const vec3 NAV_GREEN = vec3(0.15, 1.0, 0.35);
const vec3 STROBE = vec3(1.0, 1.0, 1.0);

float navDot(vec2 d) {
  return exp(-dot(d, d) * 0.9);
}

vec3 planeSlot(vec2 st, vec2 px, float time, float slot) {
  float key = mod(slot, ${f(TRAFFIC_WRAP / PLANE.period)});
  if (hash11(key * 1.91 + 5.3) > ${f(PLANE.chance)}) return vec3(0.0);
  float depart = slot * ${f(PLANE.period)} + hash11(key * 2.37 + 1.9) * ${f(PLANE.spread)};
  float e = time - depart;
  if (e < 0.0 || e > ${f(PLANE_SECONDS)}) return vec3(0.0);
  float dir = hash11(key * 3.17 + 8.3) < 0.5 ? 1.0 : -1.0;
  float s = dir > 0.0 ? ${f(PLANE.from)} + ${f(PLANE.speed)} * e : ${f(PLANE.to)} - ${f(PLANE.speed)} * e;
  float climb = (hash11(key * 5.11 + 0.7) - 0.5) * ${f(2 * PLANE.slope)};
  float t = ${f(PLANE.low)} + ${f(PLANE.high - PLANE.low)} * hash11(key * 4.73 + 2.2) + climb * s;
  vec2 d = (st - vec2(s, t)) / px;
  if (abs(d.x) > 14.0 || abs(d.y) > 10.0) return vec3(0.0);
  // Seen from the side: the far (port) wing a hair lower than the near one.
  vec2 port = vec2(-1.4 * dir, -0.7);
  vec2 starboard = vec2(1.4 * dir, 0.7);
  vec3 c = NAV_RED * 1.4 * navDot(d - port) + NAV_GREEN * 1.2 * navDot(d - starboard);
  // Double white strobe every 1.3 s; red anti-collision beacon once a second.
  float phase = fract(time / 1.3 + key * 0.37);
  float strobe = step(phase, 0.04) + step(0.12, phase) * step(phase, 0.16);
  c += STROBE * 3.2 * strobe * (navDot(d - port) + navDot(d - starboard));
  float beacon = step(fract(time + key * 0.53), 0.08);
  c += NAV_RED * 2.4 * beacon * navDot(d - vec2(0.0, -0.4));
  c += STROBE * 0.5 * navDot(d - vec2(-2.6 * dir, 0.3));
  return c;
}

vec3 planes(vec2 st, vec2 px, float time) {
  // Outside the altitude band (plus the climb and a few pixels) nothing can be lit.
  if (st.y < ${f(PLANE.low - PLANE.slope * PLANE.to)} - px.y * 12.0 || st.y > ${f(PLANE.high + PLANE.slope * PLANE.to)} + px.y * 12.0) return vec3(0.0);
  float slot = floor(time / ${f(PLANE.period)});
  return planeSlot(st, px, time, slot) + planeSlot(st, px, time, slot - 1.0);
}
`
