import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Box3, Color, Mesh, Uniform, Vector3, type Object3D } from 'three'
import { sfx } from '../../audio/sfx'
import { CAPTURE } from '../../capture/mode'
import { useStore } from '../../state/store'
import { activeLabel, clickSound, DRAG_THRESHOLD, getHotspot, LED_HOTSPOT, putsBack } from '../interaction/hotspots'
import { LAMP_MIX } from '../materials/lampMix'
import { createBulbMesh, createLeafMesh, createLedMesh, createStaticDecorGeometry, createStaticDecorMaterial, type SwayUniforms } from './decor/build'
import { createLeafAtlas } from './decor/leafAtlas'
import {
  FAIRY,
  FAIRY_CORE,
  fairyBulbs,
  fairyWire,
  LED,
  LED_LEVEL,
  ledBreath,
  ledColor,
  lampOffBoost,
  twinkle,
  type Bulb,
  type LedId,
  type LedSpec,
  type Vec3,
} from './decor/lights'
import { generatePlant, plantNodeName, PLANTS } from './decor/plants'

/** A Blender `fairy_lights` mesh: its (deduplicated) vertices are the bulbs. */
function authoredBulbs(room: Object3D): Bulb[] | null {
  const node = room.getObjectByName('fairy_lights')
  if (!(node instanceof Mesh)) return null
  node.updateWorldMatrix(true, false)
  const position = node.geometry.getAttribute('position')
  const seen = new Set<string>()
  const bulbs: Bulb[] = []
  const p = new Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld)
    const key = p
      .toArray()
      .map((value) => value.toFixed(3))
      .join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const hash = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1
    bulbs.push({ position: [p.x, p.y, p.z], phase: hash * Math.PI * 2, rate: 0.6 + hash * 1.1 })
  }
  return bulbs
}

/** A Blender `led_strip` node: its world box is the strip (along x, on the back wall). */
function authoredLed(room: Object3D): LedSpec | null {
  const node = room.getObjectByName('led_strip')
  if (!node) return null
  const box = new Box3().setFromObject(node)
  if (box.isEmpty()) return null
  return {
    ...LED,
    from: box.min.x,
    to: box.max.x,
    y: (box.min.y + box.max.y) / 2,
    z: box.max.z + 0.0005,
    height: Math.max(0.004, box.max.y - box.min.y),
  }
}

interface FrameInput {
  readonly t: number
  readonly still: boolean
  readonly led: LedId
  readonly lampMix: number
}

interface DecorRig {
  readonly objects: readonly Object3D[]
  /** The LED glow mesh (the hotspot). */
  readonly led: Object3D
  frame(input: FrameInput): void
  dispose(): void
}

function createDecor(room: Object3D): DecorRig {
  const plants = PLANTS.filter((spec) => !room.getObjectByName(plantNodeName(spec.id))).map(generatePlant)
  const authored = authoredBulbs(room)
  const bulbData = authored ?? fairyBulbs()
  const wire: readonly Vec3[] = authored ? [] : fairyWire()
  const ledFromBlender = authoredLed(room)
  const ledSpec = ledFromBlender ?? LED
  const disposables: Array<{ dispose(): void }> = []
  const objects: Object3D[] = []

  const staticGeometry = createStaticDecorGeometry({ plants, wire, led: ledFromBlender ? null : ledSpec })
  if (staticGeometry) {
    const material = createStaticDecorMaterial()
    const mesh = new Mesh(staticGeometry, material)
    mesh.name = 'decor_static'
    objects.push(mesh)
    disposables.push(staticGeometry, material)
  }
  const sway: SwayUniforms = { uTime: new Uniform(0), uSway: new Uniform(1) }
  const leaves = plants.flatMap((plant) => plant.leaves)
  if (leaves.length > 0) {
    const atlas = createLeafAtlas()
    const mesh = createLeafMesh(leaves, atlas, sway)
    objects.push(mesh)
    disposables.push(atlas, mesh.geometry, mesh)
    if (!Array.isArray(mesh.material)) disposables.push(mesh.material)
  }
  const bulbs = createBulbMesh(bulbData, FAIRY.bulb)
  objects.push(bulbs)
  disposables.push(bulbs.geometry, bulbs)
  if (!Array.isArray(bulbs.material)) disposables.push(bulbs.material)
  const { mesh: led, uniforms: ledUniforms } = createLedMesh(ledSpec)
  objects.push(led)
  disposables.push(led.geometry)
  if (!Array.isArray(led.material)) disposables.push(led.material)
  for (const object of objects) object.userData.runtimeHelper = true
  const bulbColor = new Color()

  return {
    objects,
    led,
    frame({ t, still, led: ledId, lampMix }) {
      sway.uTime.value = still ? 0 : t
      sway.uSway.value = still ? 0 : 1
      const boost = lampOffBoost(lampMix)
      bulbData.forEach((bulb, i) => {
        const k = twinkle(bulb, t, still) * boost
        bulbs.setColorAt(i, bulbColor.setRGB(FAIRY_CORE.r * k, FAIRY_CORE.g * k, FAIRY_CORE.b * k))
      })
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
      const color = ledColor(ledId)
      if (color.hex) ledUniforms.uColor.value.set(color.hex)
      const breath = ledBreath(t, still) * boost * (color.hex ? 1 : 0)
      ledUniforms.uCore.value = LED_LEVEL.core * breath
      ledUniforms.uSpill.value = LED_LEVEL.spill * breath
    },
    dispose: () => {
      for (const item of disposables) item.dispose()
    },
  }
}

export interface DecorProps {
  readonly room: Object3D
}

/**
 * Corner decorations: potted plants (a monstera, a snake plant, a trailing
 * pothos on the desk), warm fairy lights along the window sill and an LED
 * strip behind the desk that a click cycles (violet → teal → amber → off).
 * Four draw calls in all. Leaves sway a little (still with reduced motion
 * and in ?capture); the bulbs twinkle; the strip breathes slowly. With the
 * lamp off they all read a little stronger.
 */
export function Decor({ room }: DecorProps) {
  const rig = useMemo(() => createDecor(room), [room])
  useEffect(() => () => rig.dispose(), [rig])

  useFrame((state) => {
    const { reducedMotion, led } = useStore.getState()
    rig.frame({ t: state.clock.elapsedTime, still: reducedMotion || CAPTURE, led, lampMix: LAMP_MIX.value })
  })

  // The strip and its glow are one hotspot: hover names the colour, a click cycles it.
  const onPointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    useStore.getState().setHovered(LED_HOTSPOT)
    if (activeLabel(useStore.getState()) !== null) sfx('tick')
  }
  const onPointerOut = () => {
    const state = useStore.getState()
    if (state.hovered === LED_HOTSPOT) state.setHovered(null)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.delta > DRAG_THRESHOLD) return
    const state = useStore.getState()
    const def = getHotspot(LED_HOTSPOT)
    if (state.phase !== 'live' || !def) return
    if (putsBack(state, LED_HOTSPOT)) {
      sfx(state.cvOpen ? 'card' : 'calc')
      state.back()
      return
    }
    const sound = clickSound(def, state)
    if (sound) sfx(sound)
    def.activate(state)
  }

  return (
    <>
      {rig.objects.map((object) =>
        object === rig.led ? (
          <primitive key={object.uuid} object={object} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onClick={onClick} />
        ) : (
          <primitive key={object.uuid} object={object} />
        ),
      )}
    </>
  )
}
