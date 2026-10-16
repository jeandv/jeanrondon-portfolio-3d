import { useLoader } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { LoadingManager, TextureLoader, type Object3D } from 'three'
import { useStore } from '../state/store'
import { reportContract } from './contract'
import { INTERACTIVE_NODES } from './interaction/hotspots'
import {
  applyRoomMaterials,
  BAKE_GROUPS,
  bakeUrlsFor,
  HAS_BAKES,
  lampOffBakeUrls,
  prepareBakeTexture,
  type BakeGroup,
  type BakeTextures,
  type TextureSuffix,
} from './materials/baked'
import { setLampOffBake } from './materials/lampMix'

type TextureMap = Partial<Record<BakeGroup, BakeTextures>>

const NO_TEXTURES: TextureMap = {}

/** Assigns materials and checks the contract (dev). The gate conditions are reported by BootProbe. */
function useRoomSetup(room: Object3D, textures: TextureMap): void {
  useLayoutEffect(() => {
    applyRoomMaterials(room, textures, { isolate: INTERACTIVE_NODES })
    reportContract(room)
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
  useLampOffBakes(suffix)
  return <primitive object={room} />
}

/**
 * Lamp-off bakes (`<group>_irrB`): fetched once the room is live, through a
 * private LoadingManager so the boot byte counter never sees them; each one
 * plugs into its group's lamp mix as it arrives.
 */
function useLampOffBakes(suffix: TextureSuffix): void {
  const live = useStore((state) => state.phase === 'live')
  useEffect(() => {
    if (!live) return
    const entries = lampOffBakeUrls(bakeUrlsFor(suffix))
    if (entries.length === 0) return
    let cancelled = false
    const loader = new TextureLoader(new LoadingManager())
    for (const { group, url } of entries) {
      loader
        .loadAsync(url)
        .then((texture) => {
          if (cancelled) texture.dispose()
          else setLampOffBake(group, prepareBakeTexture(texture))
        })
        .catch((error: unknown) => {
          if (import.meta.env.DEV) console.warn(`[lamp] could not load ${group}_irrB; using irrA × factor`, error)
        })
    }
    return () => {
      cancelled = true
    }
  }, [live, suffix])
}

/** The room GLB. Greybox materials until M3 drops bake textures in src/assets/bake. */
export function Room({ room }: RoomProps) {
  return HAS_BAKES ? <BakedRoom room={room} /> : <GreyboxRoom room={room} />
}
