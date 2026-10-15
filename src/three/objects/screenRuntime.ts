import {
  Frustum,
  Matrix4,
  Mesh,
  type Camera,
  type Intersection,
  type Material,
  type Object3D,
  type Raycaster,
} from 'three'
import { CanvasScreen, type ScreenEnv } from '../../screens/CanvasScreen'
import { openExternal } from '../../screens/links'
import { useStore } from '../../state/store'

/**
 * Plain helpers for the screen objects (kept out of components so React
 * never sees three objects being mutated during render).
 */

/** Screen hit proxies claim to be this much (m) closer than the glass, so they win over hotspot boxes around it. */
export const SCREEN_HIT_BIAS = 0.02

export function findMesh(root: Object3D, name: string): Mesh | null {
  const object = root.getObjectByName(name)
  return object instanceof Mesh ? object : null
}

/** Puts `material` on `mesh`; the returned function restores the previous one. */
export function swapMaterial(mesh: Mesh, material: Material): () => void {
  const previous = mesh.material
  mesh.material = material
  return () => {
    if (mesh.material === material) mesh.material = previous
  }
}

/** Navigation + links for channels, wired to the store. */
export const SCREEN_ENV: ScreenEnv = {
  navigate: (hash) => useStore.getState().navigate(hash),
  openLink: openExternal,
}

export function createCanvasScreen(width: number, height: number, name: string): CanvasScreen {
  return new CanvasScreen({ width, height, name, env: SCREEN_ENV })
}

/**
 * Raycast for an invisible proxy parented to a screen mesh: it intersects the
 * real screen geometry (exact UVs) but reports itself, slightly closer, so it
 * sorts before the hotspot boxes that enclose the glass. Inactive → no hits.
 */
export function createScreenRaycast(screen: Mesh, isActive: () => boolean): Mesh['raycast'] {
  const hits: Intersection[] = []
  return function raycast(this: Object3D, raycaster: Raycaster, intersects: Intersection[]): void {
    if (!isActive()) return
    hits.length = 0
    screen.raycast(raycaster, hits)
    for (const hit of hits) intersects.push({ ...hit, object: this, distance: hit.distance - SCREEN_HIT_BIAS })
  }
}

const frustum = new Frustum()
const viewProjection = new Matrix4()

/** Whether a mesh's bounding sphere is inside the camera frustum. */
export function isInView(mesh: Mesh, camera: Camera): boolean {
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(viewProjection)
  return frustum.intersectsObject(mesh)
}
