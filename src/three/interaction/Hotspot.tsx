import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Mesh, Vector3, type Intersection, type Object3D, type Raycaster } from 'three'
import { sfx } from '../../audio/sfx'
import { useStore, type AppState } from '../../state/store'
import { contractNodeOf, setHighlight } from '../materials/baked'
import { isShown, nodeSpaceBounds } from '../objects/bounds'
import { activeLabel, clickSound, DRAG_THRESHOLD, getHotspot, HOTSPOTS, putsBack, type HotspotDef } from './hotspots'

/** Extra margin (m) around each proxy so thin parts are easy to hit. */
const PROXY_PADDING = 0.006

interface ProxyBounds {
  readonly center: [number, number, number]
  readonly size: [number, number, number]
}

/** Bounds of a node's meshes in the node's own space (proxies live as its children). */
function localBounds(node: Object3D): ProxyBounds {
  const box = nodeSpaceBounds(node)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3()).addScalar(PROXY_PADDING * 2)
  return { center: center.toArray(), size: size.toArray() }
}

/** The meshes of the named nodes (including a mesh that quantization moved into an unnamed child). */
function meshesNamed(root: Object3D, names: readonly string[]): Mesh[] {
  return names.flatMap((name) => {
    const node = root.getObjectByName(name)
    if (!node) return []
    const own = node instanceof Mesh ? [node] : []
    const moved = node.children.filter(
      (child): child is Mesh =>
        child instanceof Mesh && child.userData.hotspotProxy !== true && contractNodeOf(child) === node,
    )
    return [...own, ...moved]
  })
}

interface HotspotProxyProps {
  readonly def: HotspotDef
  readonly node: Object3D
}

/** A proxy only answers while its node is shown (a tape inside the VCR is hidden). */
function createProxyRaycast(node: Object3D): Mesh['raycast'] {
  return function raycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
    if (isShown(node)) Mesh.prototype.raycast.call(this, raycaster, intersects)
  }
}

/** Invisible, raycastable box parented to a GLB node through a portal. */
function HotspotProxy({ def, node }: HotspotProxyProps) {
  const bounds = useMemo(() => localBounds(node), [node])
  const userData = useMemo(() => ({ hotspotProxy: true, hotspot: def.id }), [def.id])
  const raycast = useMemo(() => createProxyRaycast(node), [node])

  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    useStore.getState().setHovered(def.id)
    // Only a hover that shows a tooltip ticks (live, not flying, hotspot active here).
    if (activeLabel(useStore.getState()) !== null) sfx('tick')
  }
  const onPointerOut = () => {
    const state = useStore.getState()
    if (state.hovered === def.id) state.setHovered(null)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > DRAG_THRESHOLD) return
    const state = useStore.getState()
    if (state.phase !== 'live') return
    // With the credits card (or the calculator) up, a click anywhere only puts it back.
    if (putsBack(state, def.id)) {
      sfx(state.creditsOpen ? 'card' : 'calc')
      state.back()
      return
    }
    if (def.label(state) === null) return
    const sound = clickSound(def, state)
    if (sound) sfx(sound)
    def.activate(state)
  }

  return createPortal(
    <mesh
      raycast={raycast}
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
      const label = activeLabel(state)
      // Over a screen hit rect (or with the credits card / calculator up) only the cursor changes; the hotspot stays unlit.
      const held = state.creditsOpen || (state.calcUp && state.hovered !== 'calculator')
      const def = label === null || state.screenHover || held ? undefined : getHotspot(state.hovered)
      const next = def ? meshesNamed(room, def.highlight) : []
      for (const mesh of lit) if (!next.includes(mesh)) setHighlight(mesh, false)
      for (const mesh of next) setHighlight(mesh, true)
      lit = next
      document.body.style.cursor = label === null ? '' : 'pointer'
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
