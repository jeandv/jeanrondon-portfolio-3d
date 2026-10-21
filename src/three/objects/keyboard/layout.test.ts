import { describe, expect, it } from 'vitest'
import { CAP_GAP, capIndex, codeOfNode, fitCaps, KEYBOARD_CAPS, LAYOUT_SIZE } from './layout'

describe('PC keyboard layout', () => {
  it('has a full-size US layout: 104 unique KeyboardEvent.codes', () => {
    expect(KEYBOARD_CAPS).toHaveLength(104)
    expect(new Set(KEYBOARD_CAPS.map((cap) => cap.code)).size).toBe(KEYBOARD_CAPS.length)
    expect(LAYOUT_SIZE).toEqual({ width: 22.5, depth: 6.5 })
  })

  it('maps KeyboardEvent.code to its cap index (-1 for anything else)', () => {
    for (const [i, cap] of KEYBOARD_CAPS.entries()) expect(capIndex(cap.code)).toBe(i)
    for (const code of ['KeyA', 'KeyZ', 'Digit0', 'Space', 'Enter', 'ShiftLeft', 'ArrowUp', 'NumpadEnter', 'Escape', 'F12']) {
      expect(capIndex(code)).toBeGreaterThanOrEqual(0)
    }
    expect(capIndex('Unidentified')).toBe(-1)
    expect(capIndex('keya')).toBe(-1)
  })

  it('rows follow QWERTY order left to right; the spacebar is wide and in front', () => {
    const at = (code: string) => KEYBOARD_CAPS[capIndex(code)]
    const q = at('KeyQ')
    const w = at('KeyW')
    const a = at('KeyA')
    const space = at('Space')
    if (!q || !w || !a || !space) throw new Error('missing caps')
    expect(w.x).toBeGreaterThan(q.x)
    expect(a.y).toBeGreaterThan(q.y)
    expect(space.w).toBeGreaterThan(6)
    expect(space.y).toBe(Math.max(...KEYBOARD_CAPS.map((cap) => cap.y)))
    expect(at('Enter')?.w).toBeCloseTo(2.25)
    expect(at('NumpadAdd')?.h).toBe(2)
  })

  it('no two caps overlap', () => {
    const overlaps = (i: number, j: number) => {
      const a = KEYBOARD_CAPS[i]
      const b = KEYBOARD_CAPS[j]
      if (!a || !b) return false
      return a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9
    }
    for (let i = 0; i < KEYBOARD_CAPS.length; i++) {
      for (let j = i + 1; j < KEYBOARD_CAPS.length; j++) expect(overlaps(i, j), `${KEYBOARD_CAPS[i]?.code} / ${KEYBOARD_CAPS[j]?.code}`).toBe(false)
    }
  })

  it('fits the greybox keyboard top (0.44 × 0.15 m): ~19 mm pitch, centred, inside the face', () => {
    const { unit, caps } = fitCaps(-0.22, 0.22, -0.075, 0.075)
    expect(unit).toBeGreaterThan(0.018)
    expect(unit).toBeLessThan(0.0195)
    for (const cap of caps) {
      expect(cap.x - cap.width / 2).toBeGreaterThan(-0.22)
      expect(cap.x + cap.width / 2).toBeLessThan(0.22)
      expect(cap.z - cap.depth / 2).toBeGreaterThan(-0.075)
      expect(cap.z + cap.depth / 2).toBeLessThan(0.075)
      expect(cap.width).toBeGreaterThan(0)
    }
    const space = caps[capIndex('Space')]
    expect(space?.width).toBeCloseTo((6.25 - CAP_GAP) * unit)
    // The F row is at the back (−z), the spacebar row in front.
    expect(caps[capIndex('Escape')]?.z).toBeLessThan(caps[capIndex('Space')]?.z ?? 0)
  })

  it('reads the code of a Blender cap node', () => {
    expect(codeOfNode('pc_key_KeyA')).toBe('KeyA')
    expect(codeOfNode('pc_key_Space')).toBe('Space')
    expect(codeOfNode('pc_keyboard')).toBeNull()
    expect(codeOfNode('pc_key_keya')).toBeNull()
  })
})
