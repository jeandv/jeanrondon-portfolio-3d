import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PerspectiveCamera, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { it } from 'vitest'
import { fovForAspect, frameFor } from './camera/frames'

const GLB_PATH = fileURLToPath(new URL('../assets/models/room.glb', import.meta.url))

it('probe', async () => {
  const file = await readFile(GLB_PATH)
  const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '')
  const room: Object3D = gltf.scene
  room.updateMatrixWorld(true)
  const points: Record<string, [number, number, number]> = {
    clockA: [1.78, 1.3, -0.39],
    clockB: [1.85, 1.38, -0.39],
    clockC: [1.7, 1.45, -0.39],
    clockD: [1.62, 1.42, -0.39],
    mug: [-0.42, 0.8, 0.2],
    rolodex: [-0.64, 0.78, 0.0],
  }
  for (const [w, h] of [
    [1280, 720],
    [390, 844],
  ] as const) {
    const aspect = w / h
    for (const view of ['home', 'pc', 'work'] as const) {
      const r = frameFor(view, room, { fov: fovForAspect(aspect), aspect })
      const cam = new PerspectiveCamera(fovForAspect(aspect), aspect, 0.02, 80)
      cam.position.copy(r.position)
      cam.lookAt(r.target)
      cam.updateMatrixWorld()
      const out = Object.entries(points).map(([name, p]) => {
        const ndc = new Vector3(...p).project(cam)
        return `${name}=(${Math.round(((ndc.x + 1) / 2) * w)},${Math.round(((1 - ndc.y) / 2) * h)})`
      })
      console.log(`${w}x${h} ${view}: cam ${r.position.toArray().map((v) => v.toFixed(2))} ${out.join(' ')}`)
    }
  }
})
