import { describe, expect, it } from 'vitest'
import { TAPES } from '../../../content/work'
import {
  ATLAS_ROWS,
  ATLAS_SIZE,
  atlasRow,
  fitLabelText,
  hashId,
  labelStyles,
  random,
  remapToRow,
  ROW_HEIGHT,
  ROW_PAD,
  rowUv,
  STOCKS,
} from './labelAtlas'

describe('label atlas layout', () => {
  it('maps shelf slots 1–8 to rows 0–7 (clamped)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(atlasRow)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(atlasRow(0)).toBe(0)
    expect(atlasRow(12)).toBe(ATLAS_ROWS - 1)
    expect(ATLAS_SIZE / ATLAS_ROWS).toBe(ROW_HEIGHT)
  })

  it('keeps every row inside its own band, padded (no bleeding between labels)', () => {
    for (let row = 0; row < ATLAS_ROWS; row++) {
      const uv = rowUv(row)
      expect(uv.v0).toBeCloseTo((row * ROW_HEIGHT + ROW_PAD) / ATLAS_SIZE)
      expect(uv.v1).toBeCloseTo(((row + 1) * ROW_HEIGHT - ROW_PAD) / ATLAS_SIZE)
      expect(uv.u0).toBeGreaterThan(0)
      expect(uv.u1).toBeLessThan(1)
      if (row > 0) expect(uv.v0).toBeGreaterThan(rowUv(row - 1).v1)
    }
  })

  it('remaps a 0..1 UV (glTF, v down) into the row', () => {
    const rect = rowUv(3)
    expect(remapToRow(0, 0, rect)).toEqual([rect.u0, rect.v0])
    expect(remapToRow(1, 1, rect)).toEqual([rect.u1, rect.v1])
  })
})

describe('label styles', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, id: `tape-${i}` }))

  it('derives the same style from the same ids, whatever the input order', () => {
    const a = labelStyles(entries)
    const b = labelStyles([...entries].reverse())
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
    expect(hashId('company-one')).toBe(hashId('company-one'))
    expect(hashId('company-one')).not.toBe(hashId('company-two'))
  })

  it('never repeats a stock colour on the shelf', () => {
    const stocks = [...labelStyles(entries).values()].map((style) => style.stock)
    expect(new Set(stocks).size).toBe(stocks.length)
    expect(stocks.every((stock) => STOCKS.some((candidate) => candidate.stock === stock))).toBe(true)
  })

  it('styles the real content tapes, one per slot', () => {
    const styles = labelStyles(TAPES.map((tape) => ({ slot: tape.slot, id: tape.id })))
    expect([...styles.keys()].sort((x, y) => x - y)).toEqual(TAPES.map((tape) => tape.slot).sort((x, y) => x - y))
  })

  it('has a deterministic grain / wear generator', () => {
    const first = random(42)
    const second = random(42)
    const values = Array.from({ length: 5 }, () => first())
    expect(Array.from({ length: 5 }, () => second())).toEqual(values)
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
  })
})

describe('label text fitting', () => {
  // 10 px per character per 20 px of font size.
  const measureAt = (text: string, size: number) => (text.length * size) / 2

  it('keeps short titles at the largest size', () => {
    expect(fitLabelText('ZIMA', 200, 60, 30, measureAt)).toEqual({ text: 'ZIMA', size: 60 })
  })

  it('shrinks first, then ellipsizes at the smallest size', () => {
    const shrunk = fitLabelText('STUDIO ILUXION', 300, 60, 30, measureAt)
    expect(shrunk.size).toBeLessThan(60)
    expect(shrunk.text).toBe('STUDIO ILUXION')
    const long = fitLabelText('A VERY LONG COMPANY NAME THAT NEVER FITS', 300, 60, 30, measureAt)
    expect(long.size).toBe(30)
    expect(long.text.endsWith('...')).toBe(true)
    expect(measureAt(long.text, long.size)).toBeLessThanOrEqual(300)
  })
})
