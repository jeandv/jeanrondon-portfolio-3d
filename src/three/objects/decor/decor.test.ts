import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Box3, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { POSTERS } from '../../../content/posters'
import { boxOfNodes } from '../../camera/frames'
import { wallRect } from '../posters/layout'
import { leafMatrix } from './build'
import {
  catenary,
  FAIRY,
  FAIRY_CORE,
  fairyBulbs,
  fairyWire,
  fairyWireY,
  LED,
  LED_COLORS,
  LED_LEVEL,
  ledBreath,
  ledColor,
  lampOffBoost,
  nextLed,
  twinkle,
} from './lights'
import { generatePlant, LEAF_SHAPE, leafTip, PLANTS } from './plants'

const GLB_PATH = fileURLToPath(new URL('../../../assets/models/room.glb', import.meta.url))
let room: Object3D

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  room = (await new GLTFLoader().parseAsync(buffer, '')).scene
  room.updateMatrixWorld(true)
})

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('potted plants', () => {
  const plants = PLANTS.map(generatePlant)

  it('places three plants: one by each side wall, a pothos on the desk', () => {
    expect(PLANTS.map((spec) => spec.kind).sort()).toEqual(['monstera', 'pothos', 'snake'])
    const [monstera, snake, pothos] = ['monstera', 'snake', 'pothos'].map((kind) => PLANTS.find((spec) => spec.kind === kind))
    expect(monstera?.base[0]).toBeLessThan(-2)
    expect(snake?.base[0]).toBeGreaterThan(2)
    const desk = boxOfNodes(room, ['static_desk'])
    expect(pothos?.base[1]).toBeCloseTo(desk.max.y, 3)
  })

  it('is deterministic and keeps sensible leaf counts (≤ 128 instances in all)', () => {
    expect(PLANTS.map(generatePlant)).toEqual(plants)
    const count = (kind: string) => plants.find((plant) => plant.spec.kind === kind)?.leaves.length ?? 0
    expect(count('monstera')).toBeGreaterThanOrEqual(8)
    expect(count('monstera')).toBeLessThanOrEqual(14)
    expect(count('snake')).toBeGreaterThanOrEqual(7)
    expect(count('pothos')).toBeGreaterThanOrEqual(20)
    expect(plants.reduce((sum, plant) => sum + plant.leaves.length, 0)).toBeLessThanOrEqual(128)
    for (const plant of plants) {
      for (const leaf of plant.leaves) {
        expect([LEAF_SHAPE.monstera, LEAF_SHAPE.pothos, LEAF_SHAPE.blade]).toContain(leaf.shape)
        expect(leaf.length).toBeGreaterThan(0)
        expect(leaf.sway).toBeGreaterThanOrEqual(0)
        expect(leaf.sway).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps every leaf inside the room, off the walls and under the posters', () => {
    const roomBox = boxOfNodes(room, ['static_room'])
    const rects = POSTERS.map((poster) => wallRect(poster.slot, poster.size))
    for (const plant of plants) {
      for (const leaf of plant.leaves) {
        for (const point of [leaf.position, leafTip(leaf)]) {
          expect(point[0], plant.spec.id).toBeGreaterThan(roomBox.min.x + 0.12)
          expect(point[0], plant.spec.id).toBeLessThan(roomBox.max.x - 0.12)
          expect(point[2], plant.spec.id).toBeGreaterThan(-0.38)
          expect(point[1], plant.spec.id).toBeGreaterThan(0.2)
          expect(point[1], plant.spec.id).toBeLessThan(1.25)
        }
        // Near a wall, a leaf under a poster stays below it.
        const tip = leafTip(leaf)
        for (const rect of rects) {
          const along = rect.wall === 'back' ? tip[0] : tip[2]
          const nearWall = rect.wall === 'back' ? tip[2] < -0.15 : rect.wall === 'left' ? tip[0] < -2.35 : tip[0] > 2.35
          if (nearWall && along > rect.a0 && along < rect.a1) expect(tip[1], plant.spec.id).toBeLessThan(rect.y0)
        }
      }
    }
  })

  it('gives each leaf a proper frame (length along its direction)', () => {
    const leaf = plants[0]?.leaves[0]
    if (!leaf) throw new Error('no leaf')
    const matrix = leafMatrix(leaf)
    const tip = new Vector3(0, 1, 0).applyMatrix4(matrix)
    expect(tip.toArray().map((v) => Number(v.toFixed(5)))).toEqual(leafTip(leaf).map((v) => Number(v.toFixed(5))))
  })

  it('keeps the pothos a low mound on the desk corner, clear of the tape rack', () => {
    const pothos = plants.find((plant) => plant.spec.kind === 'pothos')
    if (!pothos) throw new Error('no pothos')
    const rack = boxOfNodes(room, ['static_shelf', 'tape_08'])
    const [x, , z] = pothos.spec.base
    expect(x - pothos.spec.pot.radius).toBeGreaterThan(rack.max.x)
    expect(z - pothos.spec.pot.radius).toBeGreaterThan(-0.38)
    // Never higher than the sill's top by more than a leaf (it must not climb into the window).
    for (const leaf of pothos.leaves) expect(leafTip(leaf)[1]).toBeLessThan(0.97)
  })
})

describe('fairy lights', () => {
  it('hangs on a true catenary between ties', () => {
    expect(catenary(0, 0.03)).toBeCloseTo(0)
    expect(catenary(1, 0.03)).toBeCloseTo(0)
    expect(catenary(0.5, 0.03)).toBeCloseTo(-0.03)
    expect(catenary(0.25, 0.03)).toBeCloseTo(catenary(0.75, 0.03))
    expect(catenary(0.25, 0.03)).toBeGreaterThan(-0.03)
  })

  it('drapes along the window sill, never above it, never into the wall', () => {
    const wire = fairyWire()
    for (const [x, y, z] of wire) {
      expect(y).toBeLessThanOrEqual(FAIRY.y + 1e-9)
      expect(y).toBeGreaterThan(FAIRY.y - FAIRY.sag - 1e-9)
      expect(x).toBeGreaterThanOrEqual(FAIRY.from - 1e-9)
      expect(x).toBeLessThanOrEqual(FAIRY.to + 1e-9)
      expect(z).toBeGreaterThan(-0.4)
    }
    const bulbs = fairyBulbs()
    expect(bulbs.length).toBeGreaterThanOrEqual(30)
    expect(bulbs.length).toBeLessThanOrEqual(48)
    for (const bulb of bulbs) expect(bulb.position[1]).toBeLessThan(fairyWireY(bulb.position[0]))
    // Ties on the sill's front edge, inside the window's width.
    const glass = boxOfNodes(room, ['window_glass'])
    expect(FAIRY.from).toBeGreaterThan(glass.min.x - 0.06)
    expect(FAIRY.to).toBeLessThan(glass.max.x + 0.06)
    expect(Math.abs(FAIRY.y - glass.min.y)).toBeLessThan(0.02)
  })

  it('twinkles gently, holds still with reduced motion, and only the cores bloom', () => {
    const bulb = fairyBulbs()[3]
    if (!bulb) throw new Error('no bulb')
    const levels = Array.from({ length: 50 }, (_, i) => twinkle(bulb, i * 0.37, false))
    expect(Math.min(...levels)).toBeGreaterThan(0.65)
    expect(Math.max(...levels)).toBeLessThanOrEqual(1)
    expect(twinkle(bulb, 1, true)).toBe(twinkle(bulb, 99, true))
    expect(luma(FAIRY_CORE.r, FAIRY_CORE.g, FAIRY_CORE.b) * Math.min(...levels)).toBeGreaterThan(0.88)
  })
})

describe('the LED strip', () => {
  it('cycles violet → teal → amber → off → violet', () => {
    expect(LED_COLORS.map((color) => color.id)).toEqual(['violet', 'teal', 'amber', 'off'])
    expect(nextLed('violet')).toBe('teal')
    expect(nextLed('teal')).toBe('amber')
    expect(nextLed('amber')).toBe('off')
    expect(nextLed('off')).toBe('violet')
    expect(ledColor('off').hex).toBeNull()
    expect(ledColor('amber').label).toBe('AMBER')
  })

  it('breathes slowly, holds still with reduced motion, and never reaches the bloom threshold', () => {
    const levels = Array.from({ length: 100 }, (_, i) => ledBreath(i * 0.2, false))
    expect(Math.max(...levels)).toBeLessThanOrEqual(1)
    expect(Math.min(...levels)).toBeGreaterThan(0.7)
    expect(ledBreath(3, true)).toBe(1)
    for (const color of LED_COLORS) {
      if (!color.hex) continue
      const n = Number.parseInt(color.hex.slice(1), 16)
      const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4)
      const [r = 0, g = 0, b = 0] = lin
      expect(luma(r, g, b) * LED_LEVEL.core * lampOffBoost(1), color.id).toBeLessThan(0.88)
    }
  })

  it('runs behind the desk, on the wall, under the sill', () => {
    const desk = boxOfNodes(room, ['static_desk'])
    const glass = boxOfNodes(room, ['window_glass'])
    expect(LED.from).toBeGreaterThanOrEqual(-0.75)
    expect(LED.to).toBeLessThanOrEqual(0.85)
    expect(LED.y - LED.height / 2).toBeGreaterThan(desk.max.y)
    expect(LED.wallTop).toBeLessThan(glass.min.y)
    expect(LED.z).toBeGreaterThan(-0.4)
    expect(LED.z).toBeLessThan(-0.38)
  })

  it('reads more with the lamp off', () => {
    expect(lampOffBoost(0)).toBe(1)
    expect(lampOffBoost(1)).toBeGreaterThan(1.2)
  })
})

describe('decor budget', () => {
  it('stays inside the room box', () => {
    const roomBox = new Box3().copy(boxOfNodes(room, ['static_room']))
    for (const plant of PLANTS) expect(roomBox.containsPoint(new Vector3(...plant.base).setY(plant.base[1] + 0.01))).toBe(true)
  })
})
