import { Group, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { LABEL_NODES, OPTIONAL_NODES, validateContract } from './contract'

describe('optional contract nodes', () => {
  it('lists the eight tape label planes and the lamp bulb', () => {
    expect(LABEL_NODES).toHaveLength(8)
    expect(LABEL_NODES[0]).toBe('tape_01_label')
    expect(OPTIONAL_NODES).toContain('lamp_bulb')
    expect(OPTIONAL_NODES).toContain('tape_08_label')
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
