import { useGLTF } from '@react-three/drei'
import roomUrl from '../assets/models/room.glb?url'

/** Hashed URL of the room GLB (greybox now, Blender export from M3). */
export const ROOM_URL = roomUrl

/** Loads (suspends) the room GLB. No Draco; Meshopt for the optimized export. */
export function useRoomGLTF() {
  return useGLTF(ROOM_URL, false, true)
}

export function preloadRoom(): void {
  useGLTF.preload(ROOM_URL, false, true)
}
