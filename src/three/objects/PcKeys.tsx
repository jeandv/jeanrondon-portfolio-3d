import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three'
import { CAPTURE } from '../../capture/mode'
import { signalLastCap } from '../../state/devSignals'
import { useStore, type AppState } from '../../state/store'
import { nodeSpaceBounds } from './bounds'
import { capIndex, codeOfNode, fitCaps } from './keyboard/layout'
import { clampDt, restPose, stepSpring, type SpringParams, type SpringState } from './motion'

/**
 * The old PC's keyboard answers your typing: on #about / #online (PC in view,
 * nothing held), every physical key press sinks the matching cap ~2 mm and
 * it springs back on release. Greybox: one InstancedMesh of 104 procedural
 * caps laid over `pc_keyboard`'s top face (one draw call). A Blender export
 * with `pc_key_<code>` nodes (pc_key_KeyA…) gets those pressed instead; a
 * `pc_keyboard` whose keys are modelled in sets the custom property
 * `keycaps = 0` (no runtime caps). Mouse clicks on the screen press nothing.
 */

/** How far a cap travels (m) and its spring (quick down, a soft bounce back up). */
export const PRESS_DEPTH = 0.002
const CAP_SPRING: SpringParams = { k: 1600, c: 62 }
/** Cap height as a share of the key pitch. */
const CAP_HEIGHT = 0.36
const CAP_COLORS = { alpha: new Color('#e6dfcd'), mod: new Color('#b8ae98') } as const

/** The PC has the keyboard's attention: at the computer, no close-up, nothing held. */
function pcFocused(state: AppState): boolean {
  return (
    state.phase === 'live' &&
    state.zoom === null &&
    !state.calcUp &&
    !state.creditsOpen &&
    (state.route.page === 'about' || state.route.page === 'online')
  )
}

interface CapSet {
  /** Sinks a cap; false when the code has no cap. */
  press(code: string): boolean
  release(code: string): void
  releaseAll(): void
  frame(dt: number, snap: boolean): void
  dispose(): void
}

/** Springs per cap (index-addressed); only moving caps are integrated. */
class CapSprings {
  private readonly states: SpringState[]
  private readonly down: boolean[]
  readonly moving = new Set<number>()

  constructor(count: number) {
    this.states = Array.from({ length: count }, () => ({ x: 0, v: 0 }))
    this.down = Array.from({ length: count }, () => false)
  }

  set(index: number, pressed: boolean): void {
    if (index < 0 || index >= this.down.length || this.down[index] === pressed) return
    this.down[index] = pressed
    this.moving.add(index)
  }

  releaseAll(): void {
    this.down.forEach((pressed, index) => {
      if (pressed) this.set(index, false)
    })
  }

  /** Steps the moving caps; calls `apply(index, offset)` for each (offset ≤ 0, m). */
  step(dt: number, snap: boolean, apply: (index: number, offset: number) => void): void {
    for (const index of this.moving) {
      const target = this.down[index] ? -PRESS_DEPTH : 0
      const state = this.states[index] ?? { x: 0, v: 0 }
      let next = snap ? { x: target, v: 0 } : stepSpring(state, target, CAP_SPRING, dt)
      const settled = Math.abs(next.x - target) < 2e-6 && Math.abs(next.v) < 2e-4
      if (settled) next = { x: target, v: 0 }
      this.states[index] = next
      apply(index, next.x)
      if (settled) this.moving.delete(index)
    }
  }
}

/** The procedural caps: one InstancedMesh child of `pc_keyboard`. */
class InstancedCaps implements CapSet {
  readonly mesh: InstancedMesh
  private readonly springs: CapSprings
  private readonly base: Vector3[]
  private readonly scales: Vector3[]
  private readonly keyboard: Object3D
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly identity = new Quaternion()

  static create(keyboard: Object3D): InstancedCaps | null {
    const box = nodeSpaceBounds(keyboard)
    if (box.isEmpty()) return null
    return new InstancedCaps(keyboard, box.min, box.max)
  }

  private constructor(keyboard: Object3D, min: Vector3, max: Vector3) {
    this.keyboard = keyboard
    const { unit, caps } = fitCaps(min.x, max.x, min.z, max.z)
    const height = unit * CAP_HEIGHT
    const y = max.y + height / 2 - 0.001
    this.base = caps.map((cap) => new Vector3(cap.x, y, cap.z))
    this.scales = caps.map((cap) => new Vector3(cap.width, height, cap.depth))
    this.springs = new CapSprings(caps.length)
    const material = new MeshStandardMaterial({ name: 'M_pc_keycaps', color: '#ffffff', roughness: 0.62, metalness: 0 })
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, caps.length)
    this.mesh.name = 'pc_keycaps'
    // No contract name of its own: it hovers / glows with the keyboard; skipped by hotspot bounds.
    this.mesh.userData = { runtimeHelper: true }
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    caps.forEach((cap, i) => {
      this.write(i, 0)
      this.mesh.setColorAt(i, CAP_COLORS[cap.tone])
    })
    this.mesh.computeBoundingSphere()
  }

  attach(): void {
    this.keyboard.add(this.mesh)
  }

  press(code: string): boolean {
    const index = capIndex(code)
    if (index < 0) return false
    this.springs.set(index, true)
    return true
  }

  release(code: string): void {
    this.springs.set(capIndex(code), false)
  }

  releaseAll(): void {
    this.springs.releaseAll()
  }

  frame(dt: number, snap: boolean): void {
    if (this.springs.moving.size === 0) return
    this.springs.step(dt, snap, (index, offset) => this.write(index, offset))
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.keyboard.remove(this.mesh)
    this.mesh.geometry.dispose()
    const material = this.mesh.material
    if (!Array.isArray(material)) material.dispose()
    this.mesh.dispose()
  }

  private write(index: number, offset: number): void {
    const base = this.base[index]
    const scale = this.scales[index]
    if (!base || !scale) return
    this.position.copy(base).y += offset
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.identity, scale))
  }
}

/** Authored caps (`pc_key_<code>` nodes): each sinks along the keyboard's down axis. */
class NodeCaps implements CapSet {
  private readonly nodes: Object3D[]
  private readonly codes: Map<string, number>
  private readonly down: Vector3[]
  private readonly springs: CapSprings

  static create(room: Object3D, keyboard: Object3D | undefined): NodeCaps | null {
    const nodes: Object3D[] = []
    room.traverse((object) => {
      if (codeOfNode(object.name)) nodes.push(object)
    })
    return nodes.length > 0 ? new NodeCaps(nodes, keyboard) : null
  }

  private constructor(nodes: Object3D[], keyboard: Object3D | undefined) {
    this.nodes = nodes
    this.codes = new Map(nodes.map((node, i) => [codeOfNode(node.name) ?? '', i]))
    this.springs = new CapSprings(nodes.length)
    keyboard?.updateWorldMatrix(true, false)
    const worldDown = new Vector3(0, -1, 0)
    if (keyboard) worldDown.transformDirection(keyboard.matrixWorld)
    this.down = nodes.map((node) => {
      restPose(node)
      const parent = node.parent
      if (!parent) return worldDown.clone()
      parent.updateWorldMatrix(true, false)
      const toParent = new Matrix4().copy(parent.matrixWorld).invert()
      return worldDown.clone().transformDirection(toParent)
    })
  }

  press(code: string): boolean {
    const index = this.codes.get(code)
    if (index === undefined) return false
    this.springs.set(index, true)
    return true
  }

  release(code: string): void {
    const index = this.codes.get(code)
    if (index !== undefined) this.springs.set(index, false)
  }

  releaseAll(): void {
    this.springs.releaseAll()
  }

  frame(dt: number, snap: boolean): void {
    this.springs.step(dt, snap, (index, offset) => {
      const node = this.nodes[index]
      const down = this.down[index]
      if (!node || !down) return
      // offset ≤ 0: travel along the keyboard's down axis.
      node.position.copy(restPose(node).position).addScaledVector(down, -offset)
    })
  }

  dispose(): void {
    for (const node of this.nodes) node.position.copy(restPose(node).position)
  }
}

export interface PcKeysProps {
  readonly room: Object3D
}

export function PcKeys({ room }: PcKeysProps) {
  const caps = useMemo<{ set: CapSet; mount: () => void } | null>(() => {
    const keyboard = room.getObjectByName('pc_keyboard')
    const authored = NodeCaps.create(room, keyboard)
    if (authored) return { set: authored, mount: () => undefined }
    // A Blender keyboard with its keys modelled in opts out (custom property keycaps = 0).
    const optOut = keyboard?.userData.keycaps === 0 || keyboard?.userData.keycaps === false
    const instanced = keyboard && !optOut ? InstancedCaps.create(keyboard) : null
    return instanced ? { set: instanced, mount: () => instanced.attach() } : null
  }, [room])

  useEffect(() => {
    if (!caps) return
    caps.mount()
    if (CAPTURE) return () => caps.set.dispose()
    const onDown = (event: KeyboardEvent) => {
      if (event.repeat || !pcFocused(useStore.getState())) return
      if (caps.set.press(event.code)) signalLastCap(event.code)
    }
    // Always released, focused or not (a key held while the view changed).
    const onUp = (event: KeyboardEvent) => caps.set.release(event.code)
    const onBlur = () => caps.set.releaseAll()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      caps.set.dispose()
    }
  }, [caps])

  useFrame((_, delta) => caps?.set.frame(clampDt(delta), useStore.getState().reducedMotion))
  return null
}
