/** Seeded randomness for the generative tracks (the same seed always writes the same song). */

export type Rng = () => number

/** mulberry32: a tiny 32-bit PRNG, uniform in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

export function between(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

/** A random item (the list must not be empty). */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)]
  if (item === undefined) throw new Error('[music] pick() from an empty list')
  return item
}
