import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Mesh, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { FRAMES, frameFor, positionFor } from './camera/frames'
import { validateContract } from './contract'

const GLB_PATH = fileURLToPath(new URL('../assets/models/room.glb', import.meta.url))
const LANDSCAPE = { fov: 32, aspect: 16 / 9 }

let room: Object3D

function node(name: string): Object3D {
  const object = room.getObjectByName(name)
  if (!object) throw new Error(`missing node ${name}`)
  return object
}

/** World-space normal of a single-sided plane facing its local +Z. */
function planeNormal(name: string): Vector3 {
  return new Vector3(0, 0, 1).transformDirection(node(name).matrixWorld)
}

beforeAll(async () => {
  const file = await readFile(GLB_PATH)
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  room = gltf.scene
  room.updateMatrixWorld(true)
})

describe('greybox room.glb', () => {
  it('satisfies the naming / extras contract as loaded by three', () => {
    expect(validateContract(room)).toEqual([])
  })

  it('stays within the triangle budget and keeps both UV sets', () => {
    let triangles = 0
    room.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const geometry = object.geometry
      expect(geometry.getAttribute('uv'), object.name).toBeDefined()
      expect(geometry.getAttribute('uv1'), object.name).toBeDefined()
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    })
    expect(triangles).toBeLessThan(300_000)
  })

  it.each(['tv', 'pc'] as const)('the %s anchor puts the camera in front of its screen', (view) => {
    const screen = view === 'tv' ? 'tv_screen' : 'pc_screen'
    const resolved = frameFor(view, room, LANDSCAPE)
    const toCamera = resolved.position.clone().sub(node(screen).getWorldPosition(new Vector3())).normalize()
    // Within ~25° of the screen normal.
    expect(toCamera.dot(planeNormal(screen))).toBeGreaterThan(Math.cos((25 * Math.PI) / 180))
  })

  it('anchor_notepad_up faces the work camera', () => {
    const anchor = node('anchor_notepad_up')
    const anchorPos = anchor.getWorldPosition(new Vector3())
    const work = FRAMES.work
    const camera = positionFor(new Vector3(...work.target), work.dir, work.distance)
    const toCamera = camera.sub(anchorPos).normalize()
    expect(toCamera.dot(planeNormal('anchor_notepad_up'))).toBeGreaterThan(0.999)
  })

  it('anchor_city sits ~1 m behind the window glass', () => {
    const glass = node('window_glass').getWorldPosition(new Vector3())
    const city = node('anchor_city').getWorldPosition(new Vector3())
    expect(glass.z - city.z).toBeCloseTo(1, 2)
  })
})
