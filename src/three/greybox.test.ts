import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Mesh, PerspectiveCamera, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { boxOfNodes, FRAMES, frameFor, positionFor } from './camera/frames'
import { CLOCK_HANDS, validateContract } from './contract'

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

/** Whole node box (meshes only) in view of a camera framed like `view` at 16:9, fully inside the frame. */
function inView(name: string, view: 'home' | 'pc'): boolean {
  const resolved = frameFor(view, room, LANDSCAPE)
  const camera = new PerspectiveCamera(LANDSCAPE.fov, LANDSCAPE.aspect, 0.02, 80)
  camera.position.copy(resolved.position)
  camera.lookAt(resolved.target)
  camera.updateMatrixWorld(true)
  const box = boxOfNodes(room, [name])
  const corner = new Vector3()
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera)
    if (Math.abs(corner.x) > 1 || Math.abs(corner.y) > 1 || corner.z > 1) return false
  }
  return true
}

describe('greybox props (phase 2B)', () => {
  const DESK_TOP = 0.75

  it('a coffee mug with its coffee inside stands on the desk, left of the TV, in the home view', () => {
    const mug = node('coffee_mug')
    const liquid = node('coffee_liquid')
    expect(liquid.parent).toBe(mug)
    const mugBox = boxOfNodes(room, ['coffee_mug'])
    expect(mugBox.min.y).toBeCloseTo(DESK_TOP, 3)
    expect(mugBox.max.x).toBeLessThan(boxOfNodes(room, ['tv_body']).min.x)
    const coffee = liquid.getWorldPosition(new Vector3())
    expect(coffee.y).toBeGreaterThan(mugBox.min.y)
    expect(coffee.y).toBeLessThan(mugBox.max.y)
    expect(inView('coffee_mug', 'home')).toBe(true)
  })

  it('the wall clock hangs on the back wall facing the room, its hands on the dial centre, in the #about view', () => {
    const clock = node('wall_clock')
    const centre = clock.getWorldPosition(new Vector3())
    const face = new Vector3(0, 0, 1).transformDirection(clock.matrixWorld)
    expect(face.z).toBeGreaterThan(0.999)
    // The back of the case touches the wall (z = −0.40).
    expect(boxOfNodes(room, ['wall_clock']).min.z).toBeCloseTo(-0.4, 3)
    for (const name of CLOCK_HANDS) {
      const hand = node(name)
      expect(hand.parent).toBe(clock)
      const origin = hand.getWorldPosition(new Vector3())
      expect(Math.hypot(origin.x - centre.x, origin.y - centre.y)).toBeLessThan(1e-4)
      // Pointing to 12 at rest (local +Y), in front of the dial.
      const handBox = boxOfNodes(room, [name])
      expect(handBox.max.y - centre.y).toBeGreaterThan(0.03)
      expect(handBox.min.z).toBeGreaterThan(centre.z)
    }
    expect(inView('wall_clock', 'pc')).toBe(true)
  })

  it('the rolodex sits on the desk in front of the lamp, in the home view', () => {
    const box = boxOfNodes(room, ['rolodex'])
    expect(box.min.y).toBeCloseTo(DESK_TOP, 3)
    const lamp = boxOfNodes(room, ['lamp_head', 'lamp_arm'])
    expect(box.getCenter(new Vector3()).distanceTo(lamp.getCenter(new Vector3()))).toBeLessThan(0.6)
    expect(inView('rolodex', 'home')).toBe(true)
  })
})
