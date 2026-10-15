import {
  AddEquation,
  Color,
  CustomBlending,
  DstColorFactor,
  Mesh,
  MeshBasicMaterial,
  ZeroFactor,
  type Material,
  type Object3D,
} from 'three'

export const GLASS_NODE = 'window_glass'

/** Plan §5.7: a faint cold tint over the view (#8fa3c7 at 6%). */
export const GLASS_STYLE = { color: '#8fa3c7', opacity: 0.06 } as const

/** Drawn last among the window layers (they use renderOrder −6…−2). */
export const GLASS_RENDER_ORDER = -1

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

/**
 * Swaps the GLB's `window_glass` material for the tinted basic glass and
 * returns a restore function (StrictMode / HMR safe). No-op without the node.
 */
export function applyGlass(room: Object3D, material: Material): () => void {
  const glass = room.getObjectByName(GLASS_NODE)
  if (!(glass instanceof Mesh)) return () => {}
  const previous = { material: glass.material, renderOrder: glass.renderOrder }
  glass.material = material
  glass.renderOrder = GLASS_RENDER_ORDER
  return () => {
    glass.material = previous.material
    glass.renderOrder = previous.renderOrder
  }
}
