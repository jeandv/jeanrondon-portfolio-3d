import { useMemo } from 'react'
import { Vector3, type Object3D } from 'three'

const FALLBACK_CITY = new Vector3(-0.2, 1.625, -1.46)
const NIGHT_SKY = '#0f1830'

export interface WindowViewProps {
  readonly room: Object3D
}

/**
 * Greybox placeholder: a flat night-sky backdrop at `anchor_city` so the
 * window opening is not a black void.
 * TODO(M4): sky gradient + city_far/city_near cylinder layers, rain, glass.
 */
export function WindowView({ room }: WindowViewProps) {
  const position = useMemo(() => {
    const anchor = room.getObjectByName('anchor_city')
    if (!anchor) return FALLBACK_CITY
    anchor.updateWorldMatrix(true, false)
    return anchor.getWorldPosition(new Vector3())
  }, [room])

  return (
    <mesh position={position}>
      <planeGeometry args={[8, 4]} />
      <meshBasicMaterial color={NIGHT_SKY} />
    </mesh>
  )
}
