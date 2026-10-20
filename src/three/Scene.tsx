import { Suspense } from 'react'
import { useRoomGLTF } from './assets'
import { BootProbe } from './BootProbe'
import { CameraRig } from './camera/CameraRig'
import { Hotspots } from './interaction/Hotspot'
import { Lights } from './Lights'
import { Calculator } from './objects/Calculator'
import { CdPlayer } from './objects/CdPlayer'
import { Clock } from './objects/Clock'
import { Coffee } from './objects/Coffee'
import { CreditsCard } from './objects/CreditsCard'
import { Lamp } from './objects/Lamp'
import { Notepad } from './objects/Notepad'
import { Pc } from './objects/Pc'
import { PcKeys } from './objects/PcKeys'
import { Polaroid } from './objects/Polaroid'
import { Tapes } from './objects/Tapes'
import { Tv } from './objects/Tv'
import { Vcr } from './objects/Vcr'
import { WindowView } from './objects/WindowView'
import { Room } from './Room'

/**
 * Everything that depends on the room GLB (suspends until it is loaded).
 * Canvas screens suspend separately until the screen fonts are loaded, so
 * they never draw with a fallback font. BootProbe mounts with them, last:
 * from there it reports compile + first frames to the loader gate.
 */
export function Scene() {
  const { scene: room } = useRoomGLTF()
  return (
    <>
      <Lights />
      <Lamp room={room} />
      <Room room={room} />
      <WindowView room={room} />
      <Suspense fallback={null}>
        <Tv room={room} />
        <Pc room={room} />
        <Notepad room={room} />
        <Polaroid room={room} />
        <CreditsCard room={room} />
        <CdPlayer room={room} />
        <Calculator room={room} />
        <BootProbe />
      </Suspense>
      <Vcr room={room} />
      <Tapes room={room} />
      <Coffee room={room} />
      <Clock room={room} />
      <PcKeys room={room} />
      <Hotspots room={room} />
      <CameraRig room={room} />
    </>
  )
}
