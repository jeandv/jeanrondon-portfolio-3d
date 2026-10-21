import { Group, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  CALC_NODES,
  CD_NODES,
  CLOCK_NODES,
  DECOR_NODES,
  EXPECTED_BAKE,
  LABEL_NODES,
  MUG_NODES,
  OPTIONAL_NODES,
  OPTIONAL_SURFACES,
  PLANT_PREFIX,
  POSTER_PREFIX,
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

  it('lists the phase 3 decor (fairy lights, LED strip) and refuses a baked poster plane', () => {
    for (const name of DECOR_NODES) expect(OPTIONAL_NODES).toContain(name)
    expect(POSTER_PREFIX).toBe('poster_')
    expect(PLANT_PREFIX).toBe('plant_')
    const root = new Group()
    const poster = new Object3D()
    poster.name = 'poster_berserk'
    poster.userData = { bake: 'room' }
    root.add(poster)
    expect(validateContract(root).filter((issue) => issue.node === 'poster_berserk')).toEqual([
      { node: 'poster_berserk', problem: expect.stringContaining('must not be baked') },
    ])
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

  it('lists the CD player and the calculator (phase 2C): optional, unbaked, parts parented', () => {
    expect(CD_NODES).toEqual(['cd_player', 'cd_lid', 'cd_disc', 'cd_display'])
    expect(CALC_NODES).toEqual(['calculator', 'calc_display', 'calc_keys'])
    for (const name of [...CD_NODES, ...CALC_NODES]) {
      expect(OPTIONAL_NODES).toContain(name)
      expect(UNBAKED_OPTIONAL).toContain(name)
      expect(EXPECTED_BAKE[name]).toBeUndefined()
    }
    expect(PROP_PARENTS).toMatchObject({
      cd_lid: 'cd_player',
      cd_disc: 'cd_player',
      cd_display: 'cd_player',
      calc_display: 'calculator',
      calc_keys: 'calculator',
    })
    expect(OPTIONAL_SURFACES).toEqual(['cd_display', 'cd_disc', 'calc_display', 'calc_keys'])
  })

  it('flags a CD part outside the player and a baked calculator', () => {
    const root = new Group()
    const player = new Object3D()
    player.name = 'cd_player'
    const lid = new Object3D()
    lid.name = 'cd_lid'
    const calculator = new Object3D()
    calculator.name = 'calculator'
    calculator.userData = { bake: 'props' }
    root.add(player, lid, calculator)
    const problems = validateContract(root).map((issue) => `${issue.node}: ${issue.problem}`)
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('cd_lid: must be a child of cd_player'), expect.stringContaining('calculator: must not be baked')]),
    )
    player.add(lid)
    expect(validateContract(root).some((issue) => issue.node === 'cd_lid')).toBe(false)
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
