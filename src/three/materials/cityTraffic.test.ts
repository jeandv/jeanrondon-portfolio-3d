import { describe, expect, it } from 'vitest'
import { PLANE_GLSL, TRAIN_GLSL } from './cityTraffic'
import { hash11, PLANE, PLANE_SECONDS, planeOf, TRAFFIC_WRAP, trafficAt, TRAIN, TRAIN_LENGTH, TRAIN_SECONDS, trainOf } from './cityTraffic'
import { MOTION_TIME_WRAP } from './rain'

/** Departure time of each slot's train / plane over one clock wrap (null: no plane in that slot). */
function departures(of: (slot: number, time: number) => { elapsed: number } | null, period: number, duration: number): number[] {
  const times: number[] = []
  for (let slot = 0; slot < TRAFFIC_WRAP / period; slot++) {
    // Sample inside the slot's possible run and read back its departure.
    for (let t = slot * period; t < slot * period + period + duration; t += 1) {
      const crossing = of(slot, t)
      if (crossing) {
        times.push(t - crossing.elapsed)
        break
      }
    }
  }
  return times
}

describe('city traffic timing', () => {
  it('wraps with the window clock, and the periods divide it', () => {
    expect(TRAFFIC_WRAP).toBe(MOTION_TIME_WRAP)
    expect(TRAFFIC_WRAP % TRAIN.period).toBe(0)
    expect(TRAFFIC_WRAP % PLANE.period).toBe(0)
  })

  it('hash11 stays in [0, 1)', () => {
    for (let i = -100; i < 100; i += 0.37) {
      const h = hash11(i)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
    }
  })

  it('a train every 30–90 s, each crossing the whole arc in one direction', () => {
    const times = departures(trainOf, TRAIN.period, TRAIN_SECONDS)
    expect(times).toHaveLength(TRAFFIC_WRAP / TRAIN.period)
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0)
      expect(gap).toBeGreaterThanOrEqual(30)
      expect(gap).toBeLessThanOrEqual(90)
    }
    const train = trainOf(3, 3 * TRAIN.period + TRAIN.spread + 10)
    expect(train).not.toBeNull()
    if (!train) return
    const later = trainOf(3, 3 * TRAIN.period + TRAIN.spread + 20)
    expect(later && (later.s - train.s) * train.dir).toBeCloseTo(TRAIN.speed * 10)
    // Six cars, ~15 s across the home view's ~0.7 rad of window.
    expect(TRAIN_LENGTH).toBeGreaterThan(0.1)
    expect(0.7 / TRAIN.speed).toBeGreaterThan(10)
    expect(0.7 / TRAIN.speed).toBeLessThan(25)
  })

  it('a crossing never outlives the slot after its own (two slots are all the shaders check)', () => {
    expect(TRAIN.spread + TRAIN_SECONDS).toBeLessThan(2 * TRAIN.period)
    expect(PLANE.spread + PLANE_SECONDS).toBeLessThan(2 * PLANE.period)
    for (let t = 0; t < TRAFFIC_WRAP; t += 7.3) {
      const { trains, planes } = trafficAt(t)
      expect(trains.length).toBeLessThanOrEqual(2)
      expect(planes.length).toBeLessThanOrEqual(2)
      // The head runs one train length past the end of the arc, so the tail leaves too.
      for (const train of trains) {
        expect(train.s).toBeGreaterThanOrEqual(TRAIN.from - TRAIN_LENGTH - 1e-9)
        expect(train.s).toBeLessThanOrEqual(TRAIN.to + TRAIN_LENGTH + 1e-9)
      }
    }
  })

  it('planes: about one a minute, never more than two in any minute, slow, above the skyline', () => {
    const times = departures(planeOf, PLANE.period, PLANE_SECONDS)
    const perMinute = times.length / (TRAFFIC_WRAP / 60)
    expect(perMinute).toBeGreaterThan(0.6)
    expect(perMinute).toBeLessThanOrEqual(1.4)
    for (const start of times) {
      expect(times.filter((t) => t >= start && t < start + 60).length).toBeLessThanOrEqual(2)
    }
    // ~17 s across the home view's window.
    expect(0.7 / PLANE.speed).toBeGreaterThan(12)
    for (let t = 0; t < TRAFFIC_WRAP; t += 11.1) {
      for (const plane of trafficAt(t).planes) {
        expect(plane.t).toBeGreaterThan(PLANE.low - PLANE.slope * PLANE.to - 1e-9)
        expect(plane.t).toBeLessThan(PLANE.high + PLANE.slope * PLANE.to + 1e-9)
      }
    }
  })

  it('is continuous across the clock wrap (slot −1 is the last slot of the hour)', () => {
    const same = (a: ReturnType<typeof trainOf>, b: ReturnType<typeof trainOf>) => {
      expect(a === null).toBe(b === null)
      if (!a || !b) return
      expect(a.dir).toBe(b.dir)
      expect(a.elapsed).toBeCloseTo(b.elapsed, 6)
      expect(a.s).toBeCloseTo(b.s, 6)
      expect(a.t).toBeCloseTo(b.t, 6)
    }
    const lastSlot = TRAFFIC_WRAP / TRAIN.period - 1
    for (const t of [0.5, 10, 25]) same(trainOf(-1, t), trainOf(lastSlot, t + TRAFFIC_WRAP))
    const lastPlane = TRAFFIC_WRAP / PLANE.period - 1
    for (const t of [0.5, 5, 20]) same(planeOf(-1, t), planeOf(lastPlane, t + TRAFFIC_WRAP))
  })

  it('the shaders are generated from the same constants (no extra draw calls: functions in existing layers)', () => {
    expect(TRAIN_GLSL).toContain('vec4 trains(vec2 st, vec2 px, float ground, float time)')
    expect(TRAIN_GLSL).toContain(TRAIN.period.toFixed(5))
    expect(PLANE_GLSL).toContain('vec3 planes(vec2 st, vec2 px, float time)')
    expect(PLANE_GLSL).toContain(PLANE.chance.toFixed(5))
    // No pow() on possibly negative bases (a NaN would bloom across the frame).
    expect(TRAIN_GLSL).not.toMatch(/pow\(/)
    expect(PLANE_GLSL).not.toMatch(/pow\(/)
  })
})
