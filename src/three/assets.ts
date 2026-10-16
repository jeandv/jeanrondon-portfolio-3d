import { useGLTF } from '@react-three/drei'
import roomUrl from '../assets/models/room.glb?url'
import { assetBytes, assetKey } from '../boot/bytes'
import type { DeviceProfile } from '../hooks/useDeviceProfile'
import { trackLoaderBytes, type ProgressLoader } from './loading'
import { bakeSourcePath, bakeUrlsFor, bootBakeUrls } from './materials/baked'

/** Hashed URL of the room GLB (greybox now, Blender export from M3). */
export const ROOM_URL = roomUrl

/** Manifest key of the GLB (src/assets/sizes.json). */
const ROOM_KEY = 'models/room.glb'

/** The GLB streams its byte progress into the loader bar. */
const trackBytes = (loader: ProgressLoader) => trackLoaderBytes(loader)

/** Loads (suspends) the room GLB. No Draco; Meshopt for the optimized export. */
export function useRoomGLTF() {
  return useGLTF(ROOM_URL, false, true, trackBytes)
}

export function preloadRoom(): void {
  useGLTF.preload(ROOM_URL, false, true, trackBytes)
}

/**
 * Every request the boot waits for (GLB + albedo/irrA bakes for this device),
 * URL → expected bytes. Lamp-off bakes (irrB) load after live and never count.
 */
export function bootAssets(texSuffix: DeviceProfile['texSuffix']): ReadonlyMap<string, number> {
  const assets = new Map<string, number>([[ROOM_URL, assetBytes(ROOM_KEY)]])
  for (const url of bootBakeUrls(bakeUrlsFor(texSuffix))) {
    const path = bakeSourcePath(url)
    assets.set(url, assetBytes(path ? assetKey(path) : url))
  }
  return assets
}
