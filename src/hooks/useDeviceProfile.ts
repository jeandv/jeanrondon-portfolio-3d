import { matchesMedia, useMediaQuery } from './useMediaQuery'

export interface DeviceProfile {
  readonly phone: boolean
  /** Canvas DPR range (min, max). */
  readonly dpr: [min: number, max: number]
  /** MSAA samples for the post-processing target (M4). */
  readonly msaa: 0 | 4
  /** Suffix for half-resolution bake textures on phones. */
  readonly texSuffix: '' | '_m'
}

export const PHONE_QUERY = '(pointer: coarse) and (max-width: 820px)'

const PHONE_PROFILE: DeviceProfile = { phone: true, dpr: [1, 1.5], msaa: 0, texSuffix: '_m' }
const DESKTOP_PROFILE: DeviceProfile = { phone: false, dpr: [1, 2], msaa: 4, texSuffix: '' }

/** Stable profile objects so consumers can compare by reference. */
export function profileFor(phone: boolean): DeviceProfile {
  return phone ? PHONE_PROFILE : DESKTOP_PROFILE
}

export function getDeviceProfile(): DeviceProfile {
  return profileFor(matchesMedia(PHONE_QUERY))
}

export function useDeviceProfile(): DeviceProfile {
  return profileFor(useMediaQuery(PHONE_QUERY))
}
