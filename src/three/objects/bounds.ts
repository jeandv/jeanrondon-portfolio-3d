import { Box3, Matrix4, Mesh, type Object3D } from 'three'

/**
 * Bounds of a node's meshes in the node's own space (pose independent).
 * Skips hotspot proxies and the runtime-added helpers (labels, the bulb).
 */
export function nodeSpaceBounds(node: Object3D): Box3 {
  node.updateWorldMatrix(true, true)
  const toLocal = new Matrix4().copy(node.matrixWorld).invert()
  const box = new Box3()
  const part = new Box3()
  const matrix = new Matrix4()
  node.traverse((child) => {
    if (!(child instanceof Mesh) || child.userData.hotspotProxy === true || child.userData.runtimeHelper === true) return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    const bbox = child.geometry.boundingBox
    if (bbox) box.union(part.copy(bbox).applyMatrix4(matrix.multiplyMatrices(toLocal, child.matrixWorld)))
  })
  return box
}

/** The first mesh of a node: the node itself, or (a quantization child, a Group of primitives) its first mesh below. */
export function meshOf(node: Object3D | undefined): Mesh | null {
  if (!node) return null
  if (node instanceof Mesh) return node
  let found: Mesh | null = null
  node.traverse((child) => {
    if (!found && child instanceof Mesh && child.userData.hotspotProxy !== true) found = child
  })
  return found
}

/** Whether a node and all of its ancestors are visible. */
export function isShown(node: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}
