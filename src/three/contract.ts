import type { Object3D } from 'three'

/**
 * Blender ↔ code naming contract (docs/PLAN.md §6). Custom props from Blender
 * arrive as glTF `extras` and three exposes them as `userData`.
 */

const TAPE_NODES = Array.from({ length: 8 }, (_, i) => `tape_${String(i + 1).padStart(2, '0')}`)

export const REQUIRED_NODES: readonly string[] = [
  'static_room',
  'static_desk',
  'tv_body',
  'tv_screen',
  'vcr_body',
  'vcr_flap',
  'pc_body',
  'pc_monitor',
  'pc_screen',
  'pc_keyboard',
  'lamp_head',
  ...TAPE_NODES,
  'notepad',
  'notepad_page',
  'polaroid_photo',
  'window_glass',
  'anchor_notepad_up',
  'anchor_city',
]

/**
 * Optional spine label planes (UV0 0..1, not baked): when `tape_NN_label`
 * exists it carries that tape's label instead of the automatic decal.
 */
export const LABEL_NODES: readonly string[] = TAPE_NODES.map((name) => `${name}_label`)

/**
 * Present in the greybox (floor, shelf, lamp arm) or optional extras: the
 * label planes and `lamp_bulb` (the bulb mesh that glows when the lamp is on;
 * without it a small disc is added under `lamp_head`).
 */
export const OPTIONAL_NODES: readonly string[] = ['static_floor', 'static_shelf', 'lamp_arm', 'lamp_bulb', ...LABEL_NODES]

/** Optional nodes that get a runtime material and must not be baked. */
export const UNBAKED_OPTIONAL: readonly string[] = ['lamp_bulb', ...LABEL_NODES]

/** Expected `bake` custom prop per node (nodes not listed must not be baked). */
export const EXPECTED_BAKE: Readonly<Record<string, string>> = {
  static_room: 'room',
  static_floor: 'floor',
  static_desk: 'desk',
  static_shelf: 'shelf',
  tv_body: 'gear',
  vcr_body: 'gear',
  vcr_flap: 'gear',
  pc_body: 'gear',
  pc_monitor: 'gear',
  pc_keyboard: 'gear',
  lamp_head: 'gear',
  notepad: 'props',
  notepad_page: 'props',
  ...Object.fromEntries(TAPE_NODES.map((name) => [name, 'shelf'])),
}

/** Screens and photos receive runtime textures and need UV0 0..1. */
export const UNBAKED_SURFACES: readonly string[] = ['tv_screen', 'pc_screen', 'polaroid_photo', 'window_glass']

export interface ContractIssue {
  readonly node: string
  readonly problem: string
}

export function findMissingNodes(root: Object3D, names: readonly string[] = REQUIRED_NODES): string[] {
  return names.filter((name) => root.getObjectByName(name) === undefined)
}

/** Lists every contract violation found in a loaded GLB scene. */
export function validateContract(root: Object3D): ContractIssue[] {
  const issues: ContractIssue[] = findMissingNodes(root).map((node) => ({ node, problem: 'missing node' }))

  for (const [node, bake] of Object.entries(EXPECTED_BAKE)) {
    const object = root.getObjectByName(node)
    if (object && object.userData.bake !== bake) {
      issues.push({ node, problem: `expected userData.bake="${bake}", got ${JSON.stringify(object.userData.bake)}` })
    }
  }

  for (let slot = 1; slot <= TAPE_NODES.length; slot++) {
    const node = TAPE_NODES[slot - 1] ?? ''
    const object = root.getObjectByName(node)
    if (object && object.userData.slot !== slot) {
      issues.push({ node, problem: `expected userData.slot=${slot}, got ${JSON.stringify(object.userData.slot)}` })
    }
  }

  for (const node of UNBAKED_OPTIONAL) {
    const object = root.getObjectByName(node)
    if (object && object.userData.bake !== undefined) {
      issues.push({ node, problem: `must not be baked (remove the bake custom property)` })
    }
  }

  return issues
}

let reported = false

/** Dev-only: logs contract violations once per session via console.table. */
export function reportContract(root: Object3D): void {
  if (!import.meta.env.DEV || reported) return
  reported = true
  const issues = validateContract(root)
  if (issues.length === 0) {
    console.info('[contract] room.glb satisfies the naming contract')
    return
  }
  console.warn(`[contract] room.glb has ${issues.length} contract issue(s)`)
  console.table(issues)
}
