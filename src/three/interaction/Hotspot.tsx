import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three'
import { useStore, type AppState } from '../../state/store'
import { setHighlight } from '../materials/baked'
import { activeLabel, DRAG_THRESHOLD, getHotspot, HOTSPOTS, type HotspotDef } from './hotspots'

/** Extra margin (m) around each proxy so thin parts are easy to hit. */
const PROXY_PADDING = 0.006

interface ProxyBounds {
  readonly center: [number, number, number]
  readonly size: [number, number, number]
}

/** Bounds of a node's meshes in the node's own space (proxies live as its children). */
function localBounds(node: Object3D): ProxyBounds {
  node.updateWorldMatrix(true, true)
  const toLocal = new Matrix4().copy(node.matrixWorld).invert()
  const box = new Box3()
  const part = new Box3()
  const matrix = new Matrix4()
  node.traverse((child) => {
    if (!(child instanceof Mesh) || child.userData.hotspotProxy === true) return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    const bbox = child.geometry.boundingBox
    if (bbox) box.union(part.copy(bbox).applyMatrix4(matrix.multiplyMatrices(toLocal, child.matrixWorld)))
  })
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3()).addScalar(PROXY_PADDING * 2)
  return { center: center.toArray(), size: size.toArray() }
}

function meshesNamed(root: Object3D, names: readonly string[]): Mesh[] {
  return names.map((name) => root.getObjectByName(name)).filter((object): object is Mesh => object instanceof Mesh)
}

interface HotspotProxyProps {
  readonly def: HotspotDef
  readonly node: Object3D
}

/** Invisible, raycastable box parented to a GLB node through a portal. */
function HotspotProxy({ def, node }: HotspotProxyProps) {
  const bounds = useMemo(() => localBounds(node), [node])
  const userData = useMemo(() => ({ hotspotProxy: true, hotspot: def.id }), [def.id])

  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    useStore.getState().setHovered(def.id)
  }
  const onPointerOut = () => {
    const state = useStore.getState()
    if (state.hovered === def.id) state.setHovered(null)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > DRAG_THRESHOLD) return
    const state = useStore.getState()
    if (state.phase !== 'live' || def.label(state) === null) return
    def.activate(state)
  }

  return createPortal(
    <mesh
      position={bounds.center}
      userData={userData}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={onClick}
    >
      <boxGeometry args={bounds.size} />
      <meshBasicMaterial visible={false} />
    </mesh>,
    node,
  )
}

/** Applies hover side effects (material bump + cursor) whenever the hover state changes. */
function useHoverFeedback(room: Object3D): void {
  useEffect(() => {
    let lit: Mesh[] = []
    const apply = (state: AppState) => {
      const def = activeLabel(state) === null ? undefined : getHotspot(state.hovered)
      const next = def ? meshesNamed(room, def.highlight) : []
      for (const mesh of lit) if (!next.includes(mesh)) setHighlight(mesh, false)
      for (const mesh of next) setHighlight(mesh, true)
      lit = next
      document.body.style.cursor = def ? 'pointer' : ''
    }
    apply(useStore.getState())
    const unsubscribe = useStore.subscribe(apply)
    return () => {
      unsubscribe()
      for (const mesh of lit) setHighlight(mesh, false)
      document.body.style.cursor = ''
    }
  }, [room])
}

export interface HotspotsProps {
  readonly room: Object3D
}

/** Mounts a proxy for every registered hotspot node found in the GLB. */
export function Hotspots({ room }: HotspotsProps) {
  useHoverFeedback(room)
  const targets = useMemo(
    () =>
      HOTSPOTS.flatMap((def) =>
        def.nodes.flatMap((name) => {
          const node = room.getObjectByName(name)
          return node ? [{ def, node }] : []
        }),
      ),
    [room],
  )
  return (
    <>
      {targets.map(({ def, node }) => (
        <HotspotProxy key={`${def.id}:${node.name}`} def={def} node={node} />
      ))}
    </>
  )
}
