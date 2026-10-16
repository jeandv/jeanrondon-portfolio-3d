import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'
import { useLayoutEffect, useRef, type ComponentRef } from 'react'
import { PerspectiveCamera, type Camera, type Object3D } from 'three'
import { isBootPhase } from '../../boot/machine'
import { STILL_CALIBRATION, stillMatchedFov } from '../../boot/still'
import { CAPTURE } from '../../capture/mode'
import { useStore, type AppState } from '../../state/store'
import { clampDt } from '../objects/motion'
import { createFlight, sampleFlight, type Flight } from './flight'
import {
  fovForAspect,
  frameFor,
  ROUTE_VIEW,
  type CameraLike,
  type OrbitLimits,
  type ResolvedView,
  type ViewId,
} from './frames'

type Controls = ComponentRef<typeof OrbitControls>

/**
 * Camera view for the current state: TV zoom wins over the route's view.
 * Before the gate (and in ?capture) the camera waits on the home frame; on
 * entering it flies to a deep-linked route.
 */
function selectView(state: AppState): ViewId {
  if (CAPTURE || isBootPhase(state.phase)) return 'home'
  return state.zoom === 'tv' ? 'tv' : ROUTE_VIEW[state.route.page]
}

/** Below this (m) a re-frame is applied instantly instead of flown. */
const SETTLED_EPSILON = 1e-3
/** Relative aspect change that re-fits aspect-dependent views (anchors, #work). */
const ASPECT_EPSILON = 0.02
/** smoothTime (s) of the FOV ease from the still-matched lens to the live one. */
const FOV_SMOOTH_TIME = 0.55

/** Lens the views are framed with: always the live FOV for the aspect. */
function liveLens(aspect: number): CameraLike {
  return { fov: fovForAspect(aspect), aspect }
}

/**
 * Until the canvas has faded in over the loader still, the camera uses the
 * FOV that frames exactly what the cover-cropped still shows (same pose), so
 * the fade is seamless on any aspect. It stays while entering at home and is
 * released once live (or as soon as a deep-link flight starts).
 */
function stillLensActive(state: AppState, view: ViewId | undefined): boolean {
  if (CAPTURE || state.loaderMode !== 'still' || !STILL_CALIBRATION) return false
  if (isBootPhase(state.phase)) return true
  return state.phase === 'entering' && view === 'home'
}

function targetFov(state: AppState, view: ViewId | undefined, width: number, height: number): number {
  if (STILL_CALIBRATION && stillLensActive(state, view)) return stillMatchedFov(width, height, STILL_CALIBRATION)
  return fovForAspect(width / height)
}

function applyFov(camera: PerspectiveCamera, fov: number): void {
  camera.fov = fov
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

/** Puts the camera exactly on a view (controls are re-enabled per frame once live). */
function settle(controls: Controls, camera: Camera, view: ResolvedView): void {
  camera.position.copy(view.position)
  controls.target.copy(view.target)
  camera.lookAt(view.target)
  applyLimits(controls, view.limits)
  flushDamping(controls, camera)
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
 * OrbitControls only respond while live and not flying.
 */
export function CameraRig({ room }: CameraRigProps) {
  const controlsRef = useRef<Controls>(null)
  const flightRef = useRef<Flight | null>(null)
  const viewRef = useRef<ResolvedView | null>(null)
  const nonceRef = useRef<number | null>(null)
  const aspectRef = useRef(0)

  const camera = useThree((state) => state.camera)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const viewId = useStore(selectView)
  const recenterNonce = useStore((state) => state.recenterNonce)

  // Lens for the current size, applied at once (the per-frame ease handles the live switch).
  useLayoutEffect(() => {
    if (camera instanceof PerspectiveCamera && width > 0 && height > 0) {
      applyFov(camera, targetFov(useStore.getState(), viewRef.current?.id, width, height))
    }
  }, [camera, width, height])

  useLayoutEffect(() => {
    const controls = controlsRef.current
    if (!controls || !(camera instanceof PerspectiveCamera)) return

    const previous = viewRef.current
    const recenter = nonceRef.current !== null && nonceRef.current !== recenterNonce
    nonceRef.current = recenterNonce
    // Same view (e.g. switching tapes inside #work): keep the user's orbit.
    if (previous && previous.id === viewId && !recenter) return

    const next = frameFor(viewId, room, liveLens(camera.aspect))
    viewRef.current = next
    aspectRef.current = camera.aspect
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

  // Viewport aspect changed: re-fit views that depend on it (anchors fit
  // boxes, #work composes the TV group and the card) without flying.
  useLayoutEffect(() => {
    const controls = controlsRef.current
    const view = viewRef.current
    if (!controls || !view || view.id === 'home' || flightRef.current) return
    if (!(camera instanceof PerspectiveCamera) || width <= 0 || height <= 0) return
    const aspect = width / height
    if (Math.abs(aspect - aspectRef.current) <= ASPECT_EPSILON * aspectRef.current) return
    aspectRef.current = aspect
    const next = frameFor(view.id, room, liveLens(aspect))
    viewRef.current = next
    settle(controls, camera, next)
  }, [width, height, room, camera])

  useFrame((state, delta) => {
    const controls = controlsRef.current
    if (!controls) return
    const store = useStore.getState()
    const lens = state.camera

    if (lens instanceof PerspectiveCamera && state.size.width > 0 && state.size.height > 0) {
      const view = viewRef.current?.id
      const fov = targetFov(store, view, state.size.width, state.size.height)
      if (Math.abs(lens.fov - fov) > 1e-4) {
        if (store.reducedMotion || stillLensActive(store, view)) lens.fov = fov
        else easing.damp(lens, 'fov', fov, FOV_SMOOTH_TIME, clampDt(delta))
        lens.updateProjectionMatrix()
      }
    }

    const flight = flightRef.current
    controls.enabled = store.phase === 'live' && flight === null
    if (!flight) return
    const arrived = sampleFlight(flight, performance.now(), state.camera.position, controls.target)
    state.camera.lookAt(controls.target)
    if (!arrived) return
    flightRef.current = null
    const view = viewRef.current
    if (view) settle(controls, state.camera, view)
    store.setFlying(false)
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
