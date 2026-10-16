import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Mesh, PerspectiveCamera, Vector3, type Camera, type Object3D } from 'three'
import { GATE_FRAMES } from '../boot/progress'
import { bootSignals } from '../boot/signals'
import { CAPTURE_SETTLE_FRAMES } from '../capture/mode'
import { useStore } from '../state/store'

/** UV corners of the glass in OSD order: top-left, top-right, bottom-right, bottom-left (glTF UVs: v down). */
const UV_CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const

/** LensEffect barrel (PostFX): the composited image is slightly pincushioned toward the edges. */
const LENS_BARREL = 0.02

/**
 * Where a projected point lands after the Lens pass: it samples the input at
 * e·(1 − b·|e|²) (e = uv − ½), so a scene point at e_in shows at the e_out
 * solving e_out·(1 − b·|e_out|²) = e_in (fixed-point iteration).
 */
function throughLens(ex: number, ey: number): [number, number] {
  let ox = ex
  let oy = ey
  for (let i = 0; i < 4; i++) {
    const k = 1 - LENS_BARREL * (ox * ox + oy * oy)
    ox = ex / k
    oy = ey / k
  }
  return [ox, oy]
}

/** The `tv_screen` corners in CSS px (vertex nearest each UV corner, projected, through the lens). */
function tvCorners(scene: Object3D, camera: Camera, width: number, height: number): Array<{ x: number; y: number }> {
  const mesh = scene.getObjectByName('tv_screen')
  if (!(mesh instanceof Mesh)) return []
  const position = mesh.geometry.getAttribute('position')
  const uv = mesh.geometry.getAttribute('uv')
  if (!position || !uv) return []
  mesh.updateWorldMatrix(true, false)
  camera.updateMatrixWorld()
  return UV_CORNERS.map(([u, v]) => {
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < uv.count; i++) {
      const distance = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    const ndc = new Vector3().fromBufferAttribute(position, best).applyMatrix4(mesh.matrixWorld).project(camera)
    const [ex, ey] = throughLens(ndc.x / 2, -ndc.y / 2)
    return { x: (0.5 + ex) * width, y: (0.5 + ey) * height }
  })
}

/**
 * ?capture (dev): exposes `window.__capture` for scripts/capture-still.mjs.
 * `ready` resolves once the home view is live, compiled and has rendered a
 * few settled frames (every clock is frozen in capture mode).
 */
export function CaptureBridge() {
  const get = useThree((state) => state.get)
  const resolveRef = useRef<(() => void) | null>(null)
  const settled = useRef(0)

  useEffect(() => {
    let resolve: () => void = () => undefined
    const ready = new Promise<void>((done) => {
      resolve = done
    })
    resolveRef.current = resolve
    settled.current = 0
    window.__capture = {
      ready,
      tvCorners: () => {
        const { scene, camera, size } = get()
        return tvCorners(scene, camera, size.width, size.height)
      },
      fov: () => {
        const { camera } = get()
        return camera instanceof PerspectiveCamera ? camera.fov : 0
      },
    }
    return () => {
      resolveRef.current = null
      delete window.__capture
    }
  }, [get])

  useFrame(() => {
    const resolve = resolveRef.current
    if (!resolve) return
    if (useStore.getState().phase !== 'live' || bootSignals.getState().frames < GATE_FRAMES) return
    settled.current += 1
    if (settled.current < CAPTURE_SETTLE_FRAMES) return
    resolveRef.current = null
    resolve()
  })

  return null
}
