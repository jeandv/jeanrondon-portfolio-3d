import { matchesMedia, useMediaQuery } from './useMediaQuery'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function getReducedMotion(): boolean {
  return matchesMedia(REDUCED_MOTION_QUERY)
}

/** True when the user prefers reduced motion (camera flights become cuts). */
export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY)
}
