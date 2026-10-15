import { Color, MeshStandardMaterial, type Texture } from 'three'

export interface LitSurfaceOptions {
  readonly name: string
  /** Self-illumination so the surface stays readable at night (×map). */
  readonly glow: number
  readonly roughness: number
}

/**
 * Realtime-lit material for moving printed surfaces (notepad page, polaroid;
 * plan §5.6). The map doubles as an emissive map at low intensity, which also
 * makes the hotspot hover bump ("glowing" path in baked.ts) brighten it.
 */
export function createLitSurfaceMaterial(map: Texture, { name, glow, roughness }: LitSurfaceOptions): MeshStandardMaterial {
  return new MeshStandardMaterial({
    name,
    map,
    emissiveMap: map,
    emissive: new Color('#ffffff'),
    emissiveIntensity: glow,
    roughness,
    metalness: 0,
  })
}
