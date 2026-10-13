import { useRoomGLTF } from './assets'
import { CameraRig } from './camera/CameraRig'
import { Hotspots } from './interaction/Hotspot'
import { Lights } from './Lights'
import { WindowView } from './objects/WindowView'
import { Room } from './Room'

/**
 * Everything that depends on the room GLB (suspends until it is loaded).
 * TODO(M2): screens (Tv, Pc, Notepad), VCR flap spring, floating notepad.
 * TODO(M4): PostFX.
 */
export function Scene() {
  const { scene: room } = useRoomGLTF()
  return (
    <>
      <Lights room={room} />
      <Room room={room} />
      <WindowView room={room} />
      <Hotspots room={room} />
      <CameraRig room={room} />
    </>
  )
}
