import { Suspense } from 'react'
import { useRoomGLTF } from './assets'
import { CameraRig } from './camera/CameraRig'
import { Hotspots } from './interaction/Hotspot'
import { Lights } from './Lights'
import { Notepad } from './objects/Notepad'
import { Pc } from './objects/Pc'
import { Polaroid } from './objects/Polaroid'
import { Tapes } from './objects/Tapes'
import { Tv } from './objects/Tv'
import { Vcr } from './objects/Vcr'
import { WindowView } from './objects/WindowView'
import { Room } from './Room'

/**
 * Everything that depends on the room GLB (suspends until it is loaded).
 * Canvas screens suspend separately until the screen fonts are loaded, so
 * they never draw with a fallback font.
 * TODO(M4): PostFX.
 */
export function Scene() {
  const { scene: room } = useRoomGLTF()
  return (
    <>
      <Lights room={room} />
      <Room room={room} />
      <WindowView room={room} />
      <Suspense fallback={null}>
        <Tv room={room} />
        <Pc room={room} />
        <Notepad room={room} />
        <Polaroid room={room} />
      </Suspense>
      <Vcr room={room} />
      <Tapes room={room} />
      <Hotspots room={room} />
      <CameraRig room={room} />
    </>
  )
}
