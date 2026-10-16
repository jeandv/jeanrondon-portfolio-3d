import { HAS_BAKES } from './materials/baked'

type Vec3 = [number, number, number]

export interface LightRig {
  readonly hemisphere: { readonly sky: string; readonly ground: string; readonly intensity: number }
  readonly fill: { readonly color: string; readonly intensity: number; readonly position: Vec3 }
  readonly moon: { readonly color: string; readonly intensity: number; readonly position: Vec3 }
  readonly lamp: {
    readonly color: string
    readonly intensity: number
    readonly angle: number
    readonly penumbra: number
  }
  /** Peak intensity of the TV's light spill (TvGlow), ×channel power. */
  readonly tv: { readonly intensity: number }
}

const BAKED_RIG: LightRig = {
  hemisphere: { sky: '#3a4a7a', ground: '#2a1a0c', intensity: 0.14 },
  fill: { color: '#ffcf9a', intensity: 0.3, position: [-0.7, 1.35, 1.3] },
  moon: { color: '#9fb4ff', intensity: 0.3, position: [-1.6, 3.4, -4.5] },
  // Baked: the lamp lives in the irradiance (irrA on / irrB off), no realtime spot.
  lamp: { color: '#ffad5e', intensity: 0, angle: 0.62, penumbra: 0.65 },
  // Baked: the spill is the additive desk card only.
  tv: { intensity: 0 },
}

/**
 * 'baked' uses the plan's values: with baked lightmaps, realtime lights only
 * touch moving objects. Untextured greybox surfaces need far more light in
 * three's physical units (radiance = albedo·E/π), so the greybox rig scales
 * them up to read as a cozy night desk. Tune here.
 */
const LIGHT_RIGS: Readonly<Record<'baked' | 'greybox', LightRig>> = {
  baked: BAKED_RIG,
  greybox: {
    hemisphere: { ...BAKED_RIG.hemisphere, intensity: BAKED_RIG.hemisphere.intensity * 20 },
    fill: { ...BAKED_RIG.fill, intensity: BAKED_RIG.fill.intensity * 8 },
    moon: { ...BAKED_RIG.moon, intensity: BAKED_RIG.moon.intensity * 4 },
    // ~2700 K warm spot from the lamp head (no shadows); Lamp.tsx fades it.
    lamp: { ...BAKED_RIG.lamp, intensity: 3 },
    tv: { intensity: 5 },
  },
}

export const LIGHT_RIG: LightRig = HAS_BAKES ? LIGHT_RIGS.baked : LIGHT_RIGS.greybox

/** Share of the warm fill (the lamp's bounce) left with the lamp off. */
export const FILL_LAMP_OFF = 0.45
