/**
 * A simplified US 104-key layout for the old PC's keyboard (pure): the F row,
 * the main block, the navigation cluster with the arrows and the numpad, in
 * key units (1 u = one key pitch; rows run front-ward, +y = toward the user).
 * Each cap is addressed by its `KeyboardEvent.code`.
 */

export interface CapDef {
  /** `KeyboardEvent.code` (e.g. `KeyA`, `Space`, `NumpadEnter`). */
  readonly code: string
  /** Left edge and back edge (u). */
  readonly x: number
  readonly y: number
  /** Width and depth (u). */
  readonly w: number
  readonly h: number
  /** Modifiers and function keys are the darker caps. */
  readonly tone: 'alpha' | 'mod'
}

const caps: CapDef[] = []

function row(y: number, x: number, codes: readonly (string | readonly [string, number])[], tone: CapDef['tone'] = 'alpha'): void {
  let left = x
  for (const entry of codes) {
    const [code, w] = typeof entry === 'string' ? [entry, 1] : entry
    caps.push({ code, x: left, y, w, h: 1, tone })
    left += w
  }
}

const letters = (keys: string) => [...keys].map((key) => `Key${key}`)

// F row (y 0), then a half-key gap.
row(0, 0, ['Escape'], 'mod')
row(0, 2, ['F1', 'F2', 'F3', 'F4'], 'mod')
row(0, 6.5, ['F5', 'F6', 'F7', 'F8'], 'mod')
row(0, 11, ['F9', 'F10', 'F11', 'F12'], 'mod')
row(0, 15.25, ['PrintScreen', 'ScrollLock', 'Pause'], 'mod')
// Main block.
row(1.5, 0, ['Backquote', ...Array.from({ length: 10 }, (_, i) => `Digit${(i + 1) % 10}`), 'Minus', 'Equal'])
row(1.5, 13, [['Backspace', 2]], 'mod')
row(2.5, 0, [['Tab', 1.5]], 'mod')
row(2.5, 1.5, [...letters('QWERTYUIOP'), 'BracketLeft', 'BracketRight'])
row(2.5, 13.5, [['Backslash', 1.5]])
row(3.5, 0, [['CapsLock', 1.75]], 'mod')
row(3.5, 1.75, [...letters('ASDFGHJKL'), 'Semicolon', 'Quote'])
row(3.5, 12.75, [['Enter', 2.25]], 'mod')
row(4.5, 0, [['ShiftLeft', 2.25]], 'mod')
row(4.5, 2.25, [...letters('ZXCVBNM'), 'Comma', 'Period', 'Slash'])
row(4.5, 12.25, [['ShiftRight', 2.75]], 'mod')
row(5.5, 0, [['ControlLeft', 1.25], ['MetaLeft', 1.25], ['AltLeft', 1.25]], 'mod')
row(5.5, 3.75, [['Space', 6.25]])
row(5.5, 10, [['AltRight', 1.25], ['MetaRight', 1.25], ['ContextMenu', 1.25], ['ControlRight', 1.25]], 'mod')
// Navigation cluster and arrows.
row(1.5, 15.25, ['Insert', 'Home', 'PageUp'], 'mod')
row(2.5, 15.25, ['Delete', 'End', 'PageDown'], 'mod')
row(4.5, 16.25, ['ArrowUp'], 'mod')
row(5.5, 15.25, ['ArrowLeft', 'ArrowDown', 'ArrowRight'], 'mod')
// Numpad (the + and Enter keys are two rows deep).
row(1.5, 18.5, ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract'], 'mod')
row(2.5, 18.5, ['Numpad7', 'Numpad8', 'Numpad9'])
row(3.5, 18.5, ['Numpad4', 'Numpad5', 'Numpad6'])
row(4.5, 18.5, ['Numpad1', 'Numpad2', 'Numpad3'])
row(5.5, 18.5, [['Numpad0', 2], 'NumpadDecimal'])
caps.push({ code: 'NumpadAdd', x: 21.5, y: 2.5, w: 1, h: 2, tone: 'mod' })
caps.push({ code: 'NumpadEnter', x: 21.5, y: 4.5, w: 1, h: 2, tone: 'mod' })

export const KEYBOARD_CAPS: readonly CapDef[] = caps

/** Layout extent (u). */
export const LAYOUT_SIZE = {
  width: Math.max(...caps.map((cap) => cap.x + cap.w)),
  depth: Math.max(...caps.map((cap) => cap.y + cap.h)),
} as const

const INDEX: ReadonlyMap<string, number> = new Map(caps.map((cap, i) => [cap.code, i]))

/** Instance index of the cap for a `KeyboardEvent.code` (-1: no such cap). */
export function capIndex(code: string): number {
  return INDEX.get(code) ?? -1
}

export interface CapPlacement {
  readonly code: string
  /** Centre in the keyboard's local space (x right, z front), and the cap's size. */
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
  readonly tone: CapDef['tone']
}

/** Share of a key pitch left between two caps. */
export const CAP_GAP = 0.16

/**
 * Lays the caps over a keyboard's top face, `[minX, maxX] × [minZ, maxZ]` in
 * its local space (back = minZ): one key pitch fits the layout in with a
 * small margin, centred.
 */
export function fitCaps(minX: number, maxX: number, minZ: number, maxZ: number, margin = 0.006): { unit: number; caps: CapPlacement[] } {
  const width = maxX - minX - 2 * margin
  const depth = maxZ - minZ - 2 * margin
  const unit = Math.max(0, Math.min(width / LAYOUT_SIZE.width, depth / LAYOUT_SIZE.depth))
  const left = (minX + maxX) / 2 - (LAYOUT_SIZE.width * unit) / 2
  const back = (minZ + maxZ) / 2 - (LAYOUT_SIZE.depth * unit) / 2
  return {
    unit,
    caps: caps.map((cap) => ({
      code: cap.code,
      x: left + (cap.x + cap.w / 2) * unit,
      z: back + (cap.y + cap.h / 2) * unit,
      width: (cap.w - CAP_GAP) * unit,
      depth: (cap.h - CAP_GAP) * unit,
      tone: cap.tone,
    })),
  }
}

/** The `KeyboardEvent.code` of a Blender cap node (`pc_key_KeyA` → `KeyA`), or null. */
export function codeOfNode(name: string): string | null {
  const match = /^pc_key_([A-Z][A-Za-z0-9]*)$/.exec(name)
  return match?.[1] ?? null
}
