import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef, type ComponentRef } from 'react'
import { PerspectiveCamera, type Camera, type Object3D } from 'three'
import { useStore, type AppState } from '../../state/store'
import { createFlight, sampleFlight, type Flight } from './flight'
import { fovForAspect, frameFor, ROUTE_VIEW, type OrbitLimits, type ResolvedView, type ViewId } from './frames'

type Controls = ComponentRef<typeof OrbitControls>

/** Camera view for the current state: TV zoom wins over the route's view. */
function selectView(state: AppState): ViewId {
  return state.zoom === 'tv' ? 'tv' : ROUTE_VIEW[state.route.page]
}

/** Below this (m) a re-frame is applied instantly instead of flown. */
const SETTLED_EPSILON = 1e-3

function applyFov(camera: PerspectiveCamera, aspect: number): void {
  camera.fov = fovForAspect(aspect)
  camera.updateProjectionMatrix()
}

function applyLimits(controls: Controls, limits: OrbitLimits): void {
  controls.minDistance = limits.minDistance
  controls.maxDistance = limits.maxDistance
  controls.minPolarAngle = limits.minPolarAngle
  controls.maxPolarAngle = limits.maxPolarAngle
  controls.minAzimuthAngle = limits.minAzimuthAngle
  controls.maxAzimuthAngle = limits.maxAzimuthAngle
}

/** Discards leftover damping momentum while keeping the current pose. */
function flushDamping(controls: Controls, camera: Camera): void {
  const position = camera.position.clone()
  const target = controls.target.clone()
  controls.enableDamping = false
  controls.update()
  controls.enableDamping = true
  camera.position.copy(position)
  controls.target.copy(target)
  camera.lookAt(target)
}

/** Puts the camera exactly on a view and hands control back to the user. */
function settle(controls: Controls, camera: Camera, view: ResolvedView): void {
  camera.position.copy(view.position)
  controls.target.copy(view.target)
  camera.lookAt(view.target)
  applyLimits(controls, view.limits)
  flushDamping(controls, camera)
  controls.enabled = true
}

function isSettledOn(controls: Controls, camera: Camera, view: ResolvedView): boolean {
  return (
    camera.position.distanceTo(view.position) < SETTLED_EPSILON &&
    controls.target.distanceTo(view.target) < SETTLED_EPSILON
  )
}

export interface CameraRigProps {
  /** GLB root used to resolve anchors (pc, tv). */
  readonly room: Object3D
}

/**
 * OrbitControls with the reference limits + fly-to between views.
 * Flight: flush damping → disable controls → eased Bézier (arc waypoint) →
 * settle on arrival with the view's limits. A view change mid-flight
 * re-targets from the current interpolated pose; reduced motion cuts.
 */
export function CameraRig({ room }: CameraRigProps) {
  const controlsRef = useRef<Controls>(null)
  const flightRef = useRef<Flight | null>(null)
  const viewRef = useRef<ResolvedView | null>(null)
  const nonceRef = useRef<number | null>(null)

  const camera = useThree((state) => state.camera)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const viewId = useStore(selectView)
  const recenterNonce = useStore((state) => state.recenterNonce)

  // Aspect-dependent FOV (declared first so anchors below fit with the new FOV).
  useLayoutEffect(() => {
    if (camera instanceof PerspectiveCamera && width > 0 && height > 0) applyFov(camera, width / height)
  }, [camera, width, height])

  useLayoutEffect(() => {
    const controls = controlsRef.current
    if (!controls || !(camera instanceof PerspectiveCamera)) return

    const previous = viewRef.current
    const recenter = nonceRef.current !== null && nonceRef.current !== recenterNonce
    nonceRef.current = recenterNonce
    // Same view (e.g. switching tapes inside #work): keep the user's orbit.
    if (previous && previous.id === viewId && !recenter) return

    const next = frameFor(viewId, room, camera)
    viewRef.current = next
    const { reducedMotion, setFlying } = useStore.getState()

    if (!previous || reducedMotion || isSettledOn(controls, camera, next)) {
      flightRef.current = null
      settle(controls, camera, next)
      setFlying(false)
      return
    }

    flushDamping(controls, camera)
    controls.enabled = false
    // Leaving an arced view (the PC) arcs back with the same timing.
    const arc = Math.max(next.arc, previous.arc)
    const duration = Math.max(next.duration, previous.arc > 0 ? previous.duration : 0)
    flightRef.current = createFlight(
      camera.position,
      controls.target,
      next.position,
      next.target,
      duration,
      arc,
      performance.now(),
    )
    setFlying(true)
  }, [viewId, recenterNonce, room, camera])

  useFrame((state) => {
    const flight = flightRef.current
    const controls = controlsRef.current
    if (!flight || !controls) return
    const arrived = sampleFlight(flight, performance.now(), state.camera.position, controls.target)
    state.camera.lookAt(controls.target)
    if (!arrived) return
    flightRef.current = null
    const view = viewRef.current
    if (view) settle(controls, state.camera, view)
    useStore.getState().setFlying(false)
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      enablePan={false}
      rotateSpeed={0.5}
      zoomSpeed={0.7}
    />
  )
}
