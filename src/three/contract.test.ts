import { Group, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  CLOCK_NODES,
  EXPECTED_BAKE,
  LABEL_NODES,
  MUG_NODES,
  OPTIONAL_NODES,
  PROP_PARENTS,
  UNBAKED_OPTIONAL,
  validateContract,
} from './contract'

describe('optional contract nodes', () => {
  it('lists the eight tape label planes and the lamp bulb', () => {
    expect(LABEL_NODES).toHaveLength(8)
    expect(LABEL_NODES[0]).toBe('tape_01_label')
    expect(OPTIONAL_NODES).toContain('lamp_bulb')
    expect(OPTIONAL_NODES).toContain('tape_08_label')
  })

  it('lists the mug, the clock and the rolodex (phase 2B)', () => {
    for (const name of ['coffee_mug', 'coffee_liquid', 'wall_clock', 'clock_hour', 'clock_minute', 'clock_second', 'rolodex']) {
      expect(OPTIONAL_NODES).toContain(name)
    }
    expect(CLOCK_NODES).toEqual(['wall_clock', 'clock_hour', 'clock_minute', 'clock_second'])
    expect(EXPECTED_BAKE.rolodex).toBe('props')
    expect(UNBAKED_OPTIONAL).toEqual(expect.arrayContaining([...MUG_NODES, ...CLOCK_NODES]))
    expect(UNBAKED_OPTIONAL).not.toContain('rolodex')
  })

  it('needs the liquid in the mug and the hands on the clock, unbaked', () => {
    const root = new Group()
    const mug = new Object3D()
    mug.name = 'coffee_mug'
    const liquid = new Object3D()
    liquid.name = 'coffee_liquid'
    const clock = new Object3D()
    clock.name = 'wall_clock'
    clock.userData = { bake: 'props' }
    const hour = new Object3D()
    hour.name = 'clock_hour'
    clock.add(hour)
    // The liquid sits on the desk instead of in the mug.
    root.add(mug, liquid, clock)
    const issues = validateContract(root)
    const about = (node: string) => issues.filter((issue) => issue.node === node).map((issue) => issue.problem)
    expect(about('coffee_liquid')).toEqual([expect.stringContaining('child of coffee_mug')])
    expect(about('clock_hour')).toEqual([])
    expect(about('wall_clock')).toEqual([expect.stringContaining('must not be baked')])
    mug.add(liquid)
    expect(validateContract(root).filter((issue) => issue.node === 'coffee_liquid')).toEqual([])
    expect(PROP_PARENTS).toMatchObject({ coffee_liquid: 'coffee_mug', clock_second: 'wall_clock' })
  })

  it('flags a baked label plane or bulb', () => {
    const root = new Group()
    const label = new Object3D()
    label.name = 'tape_03_label'
    label.userData = { bake: 'shelf' }
    const bulb = new Object3D()
    bulb.name = 'lamp_bulb'
    root.add(label, bulb)
    const issues = validateContract(root).filter((issue) => issue.problem.includes('must not be baked'))
    expect(issues.map((issue) => issue.node)).toEqual(['tape_03_label'])
  })
})
