import { useLoader } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import { TextureLoader, type Object3D } from 'three'
import { useStore } from '../state/store'
import { reportContract } from './contract'
import { INTERACTIVE_NODES } from './interaction/hotspots'
import {
  applyRoomMaterials,
  BAKE_GROUPS,
  bakeUrlsFor,
  HAS_BAKES,
  type BakeGroup,
  type BakeTextures,
} from './materials/baked'

type TextureMap = Partial<Record<BakeGroup, BakeTextures>>

const NO_TEXTURES: TextureMap = {}

/** Assigns materials, checks the contract (dev) and flags the scene as live. */
function useRoomSetup(room: Object3D, textures: TextureMap): void {
  useLayoutEffect(() => {
    applyRoomMaterials(room, textures, { isolate: INTERACTIVE_NODES })
    reportContract(room)
    // TODO(M5): go through 'gate' (CLICK TO ENTER) instead of jumping to 'live'.
    useStore.getState().setPhase('live')
  }, [room, textures])
}

export interface RoomProps {
  readonly room: Object3D
}

function GreyboxRoom({ room }: RoomProps) {
  useRoomSetup(room, NO_TEXTURES)
  return <primitive object={room} />
}

/** Loads `<group>_albedo` / `<group>_irrA` (suspends) and applies baked materials. */
function BakedRoom({ room }: RoomProps) {
  const suffix = useStore((state) => state.device.texSuffix)
  const entries = useMemo(
    () =>
      BAKE_GROUPS.flatMap((group) => {
        const urls = bakeUrlsFor(suffix)[group]
        return urls ? [{ group, urls }] : []
      }),
    [suffix],
  )
  const loaded = useLoader(
    TextureLoader,
    entries.flatMap(({ urls }) => [urls.albedo, urls.irrA]),
  )
  const textures = useMemo(() => {
    const map: TextureMap = {}
    entries.forEach(({ group }, i) => {
      const albedo = loaded[i * 2]
      const irrA = loaded[i * 2 + 1]
      if (albedo && irrA) map[group] = { albedo, irrA }
    })
    return map
  }, [entries, loaded])
  useRoomSetup(room, textures)
  return <primitive object={room} />
}

/** The room GLB. Greybox materials until M3 drops bake textures in src/assets/bake. */
export function Room({ room }: RoomProps) {
  return HAS_BAKES ? <BakedRoom room={room} /> : <GreyboxRoom room={room} />
}
