/**
 * The spec validator: limits, the rig rules, and the exact message wording.
 *
 * The two fixtures are the *only* in-binary few-shot examples, built here
 * exactly as `engine-DoiMMBHL.js:252-486` builds them - including the `for`
 * loops, so the expansion is exercised rather than pasted. They double as the
 * quality bar the prompt must carry (`08` 5.2, 5.4).
 */
import { describe, expect, it } from 'vitest'
import {
  ACCESSORY_TYPES,
  CATEGORIES,
  checkRig,
  LIMITS,
  type ModelSpec,
  NODE_TYPES,
  normalizeSpec,
  paramValues,
  R6_JOINTS,
  R15_JOINTS,
  SHAPES,
  type SpecNode,
  validateSpec
} from '@/lib/generator/engines/3d/schema'

/* R15_HERO, rebuilt from `engine-DoiMMBHL.js:252-350` */

const side = (sign: number, suffix: string) => `${sign > 0 ? 'Left' : 'Right'}${suffix}`

function r15HeroParts(): SpecNode[] {
  const parts: SpecNode[] = [
    {
      name: 'LowerTorso',
      type: 'box',
      size: [2, 0.5, 1],
      position: [0, 2.2, 0],
      color: 'pants',
      pivot: [0, 2, 0]
    },
    {
      name: 'UpperTorso',
      type: 'box',
      size: [2, 1.6, 1],
      position: [0, 3.2, 0],
      color: 'shirt',
      pivot: [0, 2.45, 0]
    },
    {
      name: 'Head',
      type: 'group',
      pivot: [0, 4, 0],
      children: [
        {
          type: 'roundedBox',
          size: [1.2, 1.2, 1.2],
          radius: 0.25,
          position: [0, 4.6, 0],
          color: 'skin'
        },
        {
          type: 'group',
          mirror: 'x',
          children: [
            { type: 'box', size: [0.14, 0.24, 0.05], position: [0.24, 4.7, 0.61], color: 'eye' }
          ]
        }
      ]
    }
  ]

  for (const sign of [1, -1]) {
    const x = sign * 1.5
    parts.push(
      {
        name: side(sign, 'UpperArm'),
        type: 'box',
        size: [1, 1, 1],
        position: [x, 3.5, 0],
        color: 'shirt',
        pivot: [sign * 1, 3.75, 0]
      },
      {
        name: side(sign, 'LowerArm'),
        type: 'box',
        size: [1, 0.85, 1],
        position: [x, 2.625, 0],
        color: 'skin',
        pivot: [x, 3, 0]
      },
      {
        name: side(sign, 'Hand'),
        type: 'box',
        size: [1, 0.25, 1],
        position: [x, 2.125, 0],
        color: 'skin',
        pivot: [x, 2.2, 0]
      },
      {
        name: side(sign, 'UpperLeg'),
        type: 'box',
        size: [1, 0.95, 1],
        position: [sign * 0.5, 1.5, 0],
        color: 'pants',
        pivot: [sign * 0.5, 1.95, 0]
      },
      {
        name: side(sign, 'LowerLeg'),
        type: 'box',
        size: [1, 0.8, 1],
        position: [sign * 0.5, 0.65, 0],
        color: 'pants',
        pivot: [sign * 0.5, 1.03, 0]
      },
      {
        name: side(sign, 'Foot'),
        type: 'box',
        size: [1, 0.3, 1.2],
        position: [sign * 0.5, 0.15, 0.1],
        color: 'shoe',
        pivot: [sign * 0.5, 0.27, 0]
      }
    )
  }

  return parts
}

const R15_HERO: ModelSpec = {
  version: 1,
  name: 'Blocky hero',
  category: 'character',
  rig: 'R15',
  palette: {
    skin: '#f2c39b',
    shirt: '#3a7bd5',
    pants: '#2c3e50',
    shoe: '#1b1b1f',
    eye: '#1b1b1f'
  },
  parts: r15HeroParts()
}

/* DOG, rebuilt from `engine-DoiMMBHL.js:351-486` */

function dogParts(): SpecNode[] {
  const parts: SpecNode[] = [
    {
      name: 'Body',
      type: 'roundedBox',
      size: [1.6, 1.2, 3],
      radius: 0.3,
      position: [0, 2.2, 0],
      color: 'fur',
      pivot: [0, 2.2, 0]
    },
    {
      name: 'Head',
      type: 'group',
      pivot: [0, 2.6, 1.4],
      children: [
        {
          type: 'roundedBox',
          size: [1.1, 1, 1.2],
          radius: 0.25,
          position: [0, 3, 2],
          color: 'fur'
        },
        {
          type: 'roundedBox',
          size: [0.6, 0.45, 0.6],
          radius: 0.12,
          position: [0, 2.75, 2.75],
          color: 'muzzle'
        },
        { type: 'box', size: [0.2, 0.15, 0.1], position: [0, 2.95, 3.06], color: 'nose' },
        {
          type: 'group',
          mirror: 'x',
          children: [
            {
              type: 'box',
              size: [0.25, 0.45, 0.15],
              position: [0.38, 3.65, 1.85],
              rotation: [0, 0, -15],
              color: 'dark'
            },
            { type: 'box', size: [0.12, 0.14, 0.05], position: [0.25, 3.15, 2.61], color: 'nose' }
          ]
        }
      ]
    },
    {
      name: 'Tail',
      type: 'box',
      size: [0.3, 0.3, 1.2],
      position: [0, 2.6, -2],
      color: 'dark',
      pivot: [0, 2.6, -1.45]
    }
  ]

  for (const [end, z] of [
    ['Front', 1.1],
    ['Back', -1.1]
  ] as const) {
    for (const sign of [1, -1]) {
      const x = sign * 0.55
      const leftRight = sign > 0 ? 'Left' : 'Right'
      parts.push(
        {
          name: `${end}${leftRight}UpperLeg`,
          type: 'box',
          size: [0.45, 0.9, 0.45],
          position: [x, 1.35, z],
          color: 'fur',
          pivot: [x, 1.75, z]
        },
        {
          name: `${end}${leftRight}LowerLeg`,
          type: 'group',
          pivot: [x, 0.93, z],
          children: [
            { type: 'box', size: [0.4, 0.95, 0.4], position: [x, 0.5, z], color: 'fur' },
            { type: 'box', size: [0.45, 0.2, 0.55], position: [x, 0.1, z + 0.07], color: 'dark' }
          ]
        }
      )
    }
  }

  return parts
}

function dogSkeleton() {
  const bones: ModelSpec['skeleton'] = [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck', axis: [1, 0, 0], limits: [-30, 40] },
    { part: 'Tail', parent: 'Body', joint: 'TailBase', axis: [0, 1, 0], limits: [-45, 45] }
  ]
  for (const [end, upper, lower] of [
    ['Front', 'Shoulder', 'Elbow'],
    ['Back', 'Hip', 'Knee']
  ] as const) {
    for (const leftRight of ['Left', 'Right']) {
      bones.push(
        {
          part: `${end}${leftRight}UpperLeg`,
          parent: 'Body',
          joint: `${end}${leftRight}${upper}`,
          axis: [1, 0, 0],
          limits: [-60, 60]
        },
        {
          part: `${end}${leftRight}LowerLeg`,
          parent: `${end}${leftRight}UpperLeg`,
          joint: `${end}${leftRight}${lower}`,
          axis: [1, 0, 0],
          limits: [-10, 100]
        }
      )
    }
  }
  return bones
}

const DOG: ModelSpec = {
  version: 1,
  name: 'Puppy',
  category: 'character',
  rig: 'custom',
  palette: { fur: '#c98a4b', dark: '#7a4a24', muzzle: '#f1d7b8', nose: '#1b1b1f' },
  skeleton: dogSkeleton(),
  parts: dogParts()
}

describe('the two few-shot fixtures', () => {
  it('R15_HERO validates with no problems', () => {
    expect(validateSpec(R15_HERO)).toEqual([])
  })

  it('R15_HERO has 15 top-level parts and 5 palette colours', () => {
    expect(R15_HERO.parts).toHaveLength(15)
    expect(Object.keys(R15_HERO.palette)).toHaveLength(5)
    // No skeleton: the 15 canonical names come from the rig table.
    expect(R15_HERO.skeleton).toBeUndefined()
  })

  it('DOG validates with no problems', () => {
    expect(validateSpec(DOG)).toEqual([])
  })

  it('DOG has an 11-bone skeleton and 11 top-level parts', () => {
    expect(DOG.skeleton).toHaveLength(11)
    expect(DOG.parts).toHaveLength(11)
  })

  it('DOG names its bones with the humanoid joint vocabulary', () => {
    const joints = (DOG.skeleton ?? []).map((bone) => bone.joint)
    expect(joints).toContain('FrontLeftShoulder')
    expect(joints).toContain('BackRightKnee')
    expect(joints).toContain('TailBase')
  })
})

describe('validateSpec - top level', () => {
  it('rejects a non-object', () => {
    expect(validateSpec(null)).toEqual(['the spec is not an object'])
    expect(validateSpec('nope')).toEqual(['the spec is not an object'])
  })

  it('requires version 1', () => {
    expect(validateSpec({ ...R15_HERO, version: 2 })).toContain('version: must be 1')
  })

  it('requires a known category', () => {
    const problems = validateSpec({ ...R15_HERO, category: 'weapon' })
    expect(problems).toContain(`category: must be one of ${CATEGORIES.join(', ')}`)
  })

  it('requires an accessory type only for an accessory', () => {
    expect(validateSpec({ ...R15_HERO, category: 'accessory' })).toContain(
      `accessoryType: an accessory needs one of ${ACCESSORY_TYPES.join(', ')}`
    )
    // The same spec with a valid type clears that one problem.
    const ok = validateSpec({
      version: 1,
      category: 'accessory',
      accessoryType: 'Hat',
      palette: { a: '#ffffff' },
      parts: [{ type: 'box', size: [1, 1, 1] }]
    })
    expect(ok).toEqual([])
  })

  it('requires at least one palette colour', () => {
    expect(validateSpec({ ...R15_HERO, palette: {} })).toContain(
      'palette: needs at least one colour'
    )
  })

  it('requires at least one node', () => {
    expect(validateSpec({ ...R15_HERO, parts: [] })).toContain('parts: needs at least one node')
  })

  it('rejects a skeleton on a non-character', () => {
    const problems = validateSpec({ ...DOG, category: 'prop' })
    expect(problems).toContain('skeleton: only a "character" has a skeleton')
  })
})

describe('validateSpec - the unknown-type message', () => {
  // Quirk reproduced deliberately: `mesh` is a valid type but is omitted from
  // this message, exactly as `spec-D11M_y_m.js:680` does.
  it('lists the 12 primitives plus group, boolean, template - and not mesh', () => {
    const problems = validateSpec({
      version: 1,
      category: 'prop',
      palette: { a: '#ffffff' },
      parts: [{ type: 'meshes' }]
    })
    const message = problems.find((problem) => problem.startsWith('parts[0].type')) ?? ''
    expect(message).toBe(
      'parts[0].type: "meshes" is not one of box, roundedBox, sphere, cylinder, cone, torus, ' +
        'capsule, extrude, lathe, tube, sweep, text, group, boolean, template'
    )
    expect(message).not.toContain('mesh,')
    expect(message.endsWith('template')).toBe(true)
  })

  it('accepts all 16 node types structurally', () => {
    // Each arm only needs its own required fields; this asserts the dispatch
    // reaches every case rather than falling through to the default.
    const nodes: Record<string, SpecNode> = {
      box: { type: 'box', size: [1, 1, 1] },
      roundedBox: { type: 'roundedBox', size: [1, 1, 1] },
      sphere: { type: 'sphere', radius: 1 },
      cylinder: { type: 'cylinder', radius: 1, height: 1 },
      cone: { type: 'cone', radius: 1, height: 1 },
      torus: { type: 'torus', radius: 1 },
      capsule: { type: 'capsule', radius: 1 },
      extrude: { type: 'extrude', shape: { type: 'rect', w: 1, h: 1 }, depth: 1 },
      lathe: {
        type: 'lathe',
        profile: [
          [0, 0],
          [1, 1]
        ]
      },
      tube: {
        type: 'tube',
        path: [
          [0, 0, 0],
          [1, 0, 0]
        ],
        radius: 0.1
      },
      sweep: {
        type: 'sweep',
        shape: { type: 'circle', radius: 0.5 },
        path: [
          [0, 0, 0],
          [1, 0, 0]
        ]
      },
      text: { type: 'text', text: 'hi' },
      group: { type: 'group', children: [{ type: 'box', size: [1, 1, 1] }] },
      boolean: {
        type: 'boolean',
        op: 'union',
        children: [
          { type: 'box', size: [1, 1, 1] },
          { type: 'box', size: [2, 2, 2] }
        ]
      },
      template: { type: 'template', id: 'halo' },
      mesh: { type: 'mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }
    }

    expect(Object.keys(nodes).sort()).toEqual([...NODE_TYPES].sort())

    for (const [name, node] of Object.entries(nodes)) {
      const problems = validateSpec({
        version: 1,
        category: 'prop',
        palette: { a: '#ffffff' },
        parts: [node]
      })
      expect(problems, `${name} should validate`).toEqual([])
    }
  })
})

describe('validateSpec - the J limits', () => {
  const spec = (parts: SpecNode[]) => ({
    version: 1,
    category: 'prop',
    palette: { a: '#ffffff' },
    parts
  })

  it('accepts 400 nodes and rejects 401', () => {
    const node = (): SpecNode => ({ type: 'box', size: [1, 1, 1] })
    expect(validateSpec(spec(Array.from({ length: 400 }, node)))).toEqual([])
    expect(validateSpec(spec(Array.from({ length: 401 }, node)))).toContain(
      `parts: more than ${LIMITS.nodes} nodes`
    )
  })

  it('reports the node overflow exactly once', () => {
    const node = (): SpecNode => ({ type: 'box', size: [1, 1, 1] })
    const problems = validateSpec(spec(Array.from({ length: 410 }, node)))
    expect(problems.filter((problem) => problem.includes('nodes'))).toHaveLength(1)
  })

  it('accepts depth 8 and rejects depth 9', () => {
    // A chain of `group` nodes: the root is depth 0, so `chain(8)` puts the
    // innermost box at depth 8 and `chain(9)` puts it at depth 9.
    const chain = (depth: number): SpecNode => {
      let node: SpecNode = { type: 'box', size: [1, 1, 1] }
      for (let level = 0; level < depth; level++) {
        node = { type: 'group', children: [node] }
      }
      return node
    }
    const innermost = `parts[0]${'.children[0]'.repeat(9)}`
    expect(validateSpec(spec([chain(8)]))).toEqual([])
    expect(validateSpec(spec([chain(9)]))).toContain(
      `${innermost}: nested deeper than ${LIMITS.depth}`
    )
  })

  it('rejects more than 16 boolean nodes', () => {
    const one: SpecNode = {
      type: 'boolean',
      op: 'union',
      children: [
        { type: 'box', size: [1, 1, 1] },
        { type: 'box', size: [1, 1, 1] }
      ]
    }
    expect(validateSpec(spec(Array.from({ length: 16 }, () => ({ ...one }))))).toEqual([])
    expect(validateSpec(spec(Array.from({ length: 17 }, () => ({ ...one }))))).toContain(
      'parts[16]: more than 16 boolean nodes'
    )
  })

  it('rejects a scalar beyond the extent bound', () => {
    const problems = validateSpec(spec([{ type: 'sphere', radius: 2001 }]))
    expect(problems).toEqual(['parts[0].radius: 2001 is out of range'])
    // The bound itself is inside.
    expect(validateSpec(spec([{ type: 'sphere', radius: 2000 }]))).toEqual([])
  })

  it('enforces the extent on an expression result, not just a literal', () => {
    const problems = validateSpec(spec([{ type: 'sphere', radius: '400 * 6' }]))
    expect(problems).toEqual(['parts[0].radius: 2400 is out of range'])
  })

  it('caps group.array.count at 64', () => {
    const group = (count: unknown): SpecNode => ({
      type: 'group',
      array: { count, step: [1, 0, 0] },
      children: [{ type: 'box', size: [1, 1, 1] }]
    })
    expect(validateSpec(spec([group(64)]))).toEqual([])
    expect(validateSpec(spec([group(65)]))).toContain('parts[0].array.count: at most 64')
  })

  it('rejects a chain whose segments do not touch', () => {
    const link = (y: number): SpecNode => ({
      type: 'sphere',
      radius: 1,
      position: [0, y, 0]
    })
    const chain = (children: SpecNode[]): SpecNode => ({
      name: 'Neck',
      type: 'group',
      chain: true,
      children
    })
    expect(validateSpec(spec([chain([link(0), link(1.8), link(3.6)])]))).toEqual([])
    expect(validateSpec(spec([chain([link(0), link(2.4)])]))).toContain(
      'parts[0].chain[1]: 2.40 studs from the segment before it, which reaches 2.00; ' +
        'the chain has a gap. Move it closer, or make it longer.'
    )
  })

  it('measures a cylinder along its height, not its radius', () => {
    const segments: SpecNode[] = [
      { type: 'cylinder', radius: 0.5, height: 4, position: [0, 0, 0] },
      { type: 'cylinder', radius: 0.5, height: 4, position: [0, 3.5, 0] }
    ]
    expect(validateSpec(spec([{ type: 'group', chain: true, children: segments }]))).toEqual([])
  })

  it('only enforces continuity where a group opts in with chain', () => {
    const apart: SpecNode[] = [
      { type: 'sphere', radius: 1, position: [0, 0, 0] },
      { type: 'sphere', radius: 1, position: [0, 40, 0] }
    ]
    expect(validateSpec(spec([{ type: 'group', children: apart }]))).toEqual([])
    expect(validateSpec(spec([{ type: 'group', chain: true, children: apart }]))).toHaveLength(1)
  })

  it('rejects array and mirror on a node the builder will not expand', () => {
    expect(
      validateSpec(spec([{ type: 'box', size: [1, 1, 1], array: { count: 9, step: [2, 0, 0] } }]))
    ).toContain('parts[0].array: only a "group" can repeat; wrap the node in a group')
    expect(validateSpec(spec([{ type: 'box', size: [1, 1, 1], mirror: 'x' }]))).toContain(
      'parts[0].mirror: only a "group" can mirror; wrap the node in a group'
    )
    expect(
      validateSpec(spec([{ type: 'sphere', radius: 1, array: { count: 2, step: [1, 0, 0] } }]))
    ).toContain('parts[0].array: only a "group" can repeat; wrap the node in a group')
  })

  it('rejects a non-radial array with no step, using the tuple message', () => {
    // `array.step ?? []` is validated, so the message is `must be [3 numbers]`
    // rather than a dedicated "step is required" string (`08` 15 B3).
    const problems = validateSpec(
      spec([
        {
          type: 'group',
          array: { count: 2 },
          children: [{ type: 'box', size: [1, 1, 1] }]
        }
      ])
    )
    expect(problems).toContain('parts[0].array.step: must be [3 numbers]')
  })

  it('allows a radial array with no step', () => {
    expect(
      validateSpec(
        spec([
          {
            type: 'group',
            array: { count: 6, radial: true },
            children: [{ type: 'box', size: [1, 1, 1] }]
          }
        ])
      )
    ).toEqual([])
  })

  it('caps text at 40 characters', () => {
    expect(validateSpec(spec([{ type: 'text', text: 'x'.repeat(40) }]))).toEqual([])
    expect(validateSpec(spec([{ type: 'text', text: 'x'.repeat(41) }]))).toContain(
      'parts[0].text: 1 to 40 characters'
    )
  })

  it('caps shape.points at 200', () => {
    const points = Array.from({ length: 200 }, (_, i) => [i, i])
    const node = (list: number[][]): SpecNode => ({
      type: 'extrude',
      depth: 1,
      shape: { type: 'points', points: list }
    })
    expect(validateSpec(spec([node(points)]))).toEqual([])
    expect(validateSpec(spec([node([...points, [1, 1]])]))).toContain(
      'parts[0].shape.points: at most 200'
    )
  })

  it('caps mesh positions at 180 000 numbers, reported in triangles', () => {
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    const ok = Array.from({ length: LIMITS.meshNumbers / 9 }, () => tri).flat()
    expect(validateSpec(spec([{ type: 'mesh', positions: ok }]))).toEqual([])
    const over = [...ok, ...tri]
    expect(validateSpec(spec([{ type: 'mesh', positions: over }]))).toContain(
      'parts[0].positions: at most 20000 triangles'
    )
  })
})

describe('validateSpec - part names and palette', () => {
  const spec = (parts: SpecNode[], palette: Record<string, unknown> = { a: '#ffffff' }) => ({
    version: 1,
    category: 'prop',
    palette,
    parts
  })
  const oneNode: SpecNode[] = [{ type: 'box', size: [1, 1, 1] }]

  it('accepts a 40-character name and rejects 41', () => {
    expect(validateSpec(spec([{ type: 'box', size: [1, 1, 1], name: 'n'.repeat(40) }]))).toEqual([])
    expect(validateSpec(spec([{ type: 'box', size: [1, 1, 1], name: 'n'.repeat(41) }]))).toContain(
      'parts[0].name: a part name is 1 to 40 characters'
    )
  })

  it('rejects a blank name', () => {
    expect(validateSpec(spec([{ type: 'box', size: [1, 1, 1], name: '   ' }]))).toContain(
      'parts[0].name: a part name is 1 to 40 characters'
    )
  })

  it('rejects a colour that is not in the palette', () => {
    expect(validateSpec(spec([{ type: 'box', size: [1, 1, 1], color: 'ghost' }]))).toContain(
      'parts[0].color: "ghost" is not in the palette'
    )
  })

  it('accepts #rrggbb and rejects shorthand or alpha', () => {
    expect(validateSpec(spec(oneNode, { a: '#ABCDEF' }))).toEqual([])
    expect(validateSpec(spec(oneNode, { a: '#fff' }))).toContain(
      'palette.a: "#fff" is not a #rrggbb colour (or { "texture": "<name>", "tile": 2 })'
    )
    expect(validateSpec(spec(oneNode, { a: '#ffffff80' }))).toContain(
      'palette.a: "#ffffff80" is not a #rrggbb colour (or { "texture": "<name>", "tile": 2 })'
    )
  })

  it('caps the palette at 64 colours', () => {
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, '#ffffff']))
    expect(validateSpec(spec(oneNode, many))).toContain('palette: at most 64 colours')
  })

  it('requires a textured colour to name a declared texture', () => {
    expect(validateSpec(spec(oneNode, { a: { texture: 'nope' } }))).toContain(
      'palette.a.texture: "nope" is not in "textures"'
    )
  })

  it('bounds tile to 0.1..200 studs per repeat', () => {
    const withTile = (tile: number) => ({
      version: 1,
      category: 'prop',
      palette: { a: { texture: 't', tile } },
      textures: { t: { path: 'images/t.png' } },
      parts: [{ type: 'box', size: [1, 1, 1] }]
    })
    expect(validateSpec(withTile(2))).toEqual([])
    expect(validateSpec(withTile(0.05))).toContain('palette.a.tile: studs per repeat, 0.1 to 200')
    expect(validateSpec(withTile(201))).toContain('palette.a.tile: studs per repeat, 0.1 to 200')
  })

  it('caps textured colours at 8', () => {
    const palette = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`c${i}`, { texture: 't' }])
    )
    const textures = { t: { path: 'images/t.png' } }
    expect(
      validateSpec({
        version: 1,
        category: 'prop',
        palette,
        textures,
        parts: [{ type: 'box', size: [1, 1, 1] }]
      })
    ).toContain(`palette: at most 8 textured colours (they share one 1024${'\u00b2'} texture)`)
  })
})

describe('validateSpec - shapes and primitive field rules', () => {
  const spec = (parts: SpecNode[]) => ({
    version: 1,
    category: 'prop',
    palette: { a: '#ffffff' },
    parts
  })

  it('lists the 8 shape types', () => {
    expect(SHAPES).toHaveLength(8)
    expect(validateSpec(spec([{ type: 'extrude', depth: 1 }]))).toContain(
      `parts[0].shape: shape.type must be one of ${SHAPES.join(', ')}`
    )
  })

  it('requires extrude.depth even though the builder would default it', () => {
    // The validator runs first and throws, so the builder default is unreachable.
    const problems = validateSpec(spec([{ type: 'extrude', shape: { type: 'rect', w: 1, h: 1 } }]))
    expect(problems.some((problem) => problem.startsWith('parts[0].depth'))).toBe(true)
  })

  it('does not require capsule.length, which the builder silently defaults to 0.5', () => {
    // Quirk reproduced (`08` 15 B2).
    expect(validateSpec(spec([{ type: 'capsule', radius: 1 }]))).toEqual([])
  })

  it('lets radiusTop/radiusBottom stand in for radius on a cylinder', () => {
    expect(
      validateSpec(spec([{ type: 'cylinder', radiusTop: 1, radiusBottom: 2, height: 3 }]))
    ).toEqual([])
  })

  it('requires a height on a cylinder', () => {
    const problems = validateSpec(spec([{ type: 'cylinder', radius: 1 }]))
    expect(problems.some((problem) => problem.startsWith('parts[0].height'))).toBe(true)
  })

  it('requires 2 or more lathe profile pairs', () => {
    expect(validateSpec(spec([{ type: 'lathe', profile: [[0, 0]] }]))).toContain(
      'parts[0].profile: needs 2 or more [radius, y]'
    )
  })

  it('requires 2 or more path points on a tube and a sweep', () => {
    expect(validateSpec(spec([{ type: 'tube', path: [[0, 0, 0]], radius: 0.1 }]))).toContain(
      'parts[0].path: needs 2 or more [x,y,z]'
    )
    expect(
      validateSpec(spec([{ type: 'sweep', shape: { type: 'circle' }, path: [[0, 0, 0]] }]))
    ).toContain('parts[0].path: needs 2 or more [x,y,z]')
  })

  it('requires a template id that exists in the catalog', () => {
    expect(validateSpec(spec([{ type: 'template', id: 'spaceship' }]))).toContain(
      'parts[0].id: no template "spaceship"'
    )
  })

  it('requires a boolean op and 2 or more children', () => {
    const problems = validateSpec(
      spec([{ type: 'boolean', op: 'xor', children: [{ type: 'box', size: [1, 1, 1] }] }])
    )
    expect(problems).toContain('parts[0].op: must be one of union, subtract, intersect')
    expect(problems).toContain('parts[0].children: needs 2 or more nodes')
  })

  it('requires a group to have children', () => {
    expect(validateSpec(spec([{ type: 'group' }]))).toContain('parts[0].children: needs nodes')
  })

  it('restricts mirror to x or z', () => {
    expect(
      validateSpec(
        spec([
          {
            type: 'group',
            mirror: 'y' as 'x',
            children: [{ type: 'box', size: [1, 1, 1] }]
          }
        ])
      )
    ).toContain('parts[0].mirror: must be "x" or "z"')
  })

  it('rejects a mesh that is not whole triangles', () => {
    expect(validateSpec(spec([{ type: 'mesh', positions: [0, 0, 0, 1, 0, 0] }]))).toContain(
      'parts[0].positions: needs whole triangles (9 numbers each)'
    )
  })
})

describe('validateSpec - expressions reach every numeric field', () => {
  it('evaluates a size given as an expression', () => {
    expect(
      validateSpec({
        version: 1,
        category: 'prop',
        palette: { a: '#ffffff' },
        params: { w: { value: 2, min: 1, max: 4 } },
        parts: [{ type: 'box', size: ['$w', 'sin(90)', 'clamp(9, 0, 1)'] }]
      })
    ).toEqual([])
  })

  it('surfaces a parse error on the field that carries it', () => {
    const problems = validateSpec({
      version: 1,
      category: 'prop',
      palette: { a: '#ffffff' },
      parts: [{ type: 'box', size: [1, 'sin 30', 1] }]
    })
    expect(problems).toEqual(['parts[0].size[1]: bad expression "sin 30": sin needs ('])
  })
})

describe('checkRig', () => {
  it('does nothing for a non-character', () => {
    expect(checkRig({ category: 'prop' })).toEqual([])
  })

  it('requires a known rig', () => {
    expect(checkRig({ category: 'character', parts: [] })).toContain(
      'rig: a character needs "rig": R15, R6, custom'
    )
  })

  it('requires every part to be named and pivoted', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'custom',
      skeleton: [{ part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' }],
      parts: [{ type: 'box', size: [1, 1, 1] } as SpecNode]
    })
    expect(problems).toContain(
      'parts[0].name: every part of a rigged character is named (its bone)'
    )
    expect(problems).toContain(
      'parts[0].pivot: every part of a rigged character has a pivot at its joint'
    )
  })

  it('reports the missing canonical parts of an R15 body', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'R15',
      parts: [{ name: 'LowerTorso', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }]
    })
    const message = problems.find((problem) => problem.includes('missing')) ?? ''
    expect(message).toContain('UpperTorso, Head, LeftUpperArm')
    expect(message).toContain('RightFoot missing')
  })

  it('accepts the canonical R15 set', () => {
    expect(
      checkRig({
        category: 'character',
        rig: 'R15',
        parts: R15_JOINTS.map((joint) => ({
          name: joint.part,
          type: 'box',
          size: [1, 1, 1],
          pivot: [0, 0, 0]
        }))
      })
    ).toEqual([])
  })

  it('accepts the canonical R6 set, whose names contain spaces', () => {
    expect(
      checkRig({
        category: 'character',
        rig: 'R6',
        parts: R6_JOINTS.map((joint) => ({
          name: joint.part,
          type: 'box',
          size: [1, 1, 1],
          pivot: [0, 0, 0]
        }))
      })
    ).toEqual([])
    expect(R6_JOINTS.map((joint) => joint.part)).toContain('Left Arm')
  })

  it('asks for an extra R15 part to be declared as a bone', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'R15',
      parts: [
        ...R15_JOINTS.map((joint) => ({
          name: joint.part,
          type: 'box',
          size: [1, 1, 1],
          pivot: [0, 0, 0]
        })),
        { name: 'Tail', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }
      ]
    })
    expect(problems).toContain(
      'parts: Tail: not an R15 part; add it to "skeleton" with its parent ' +
        "(an extra bone, e.g. a tail) or put it inside a body part's group"
    )
  })

  it('requires a custom rig to list its bones', () => {
    expect(
      checkRig({
        category: 'character',
        rig: 'custom',
        parts: [{ name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }]
      })
    ).toContain('skeleton: a custom rig lists its bones: [{ "part", "parent", "joint" }]')
  })

  it('requires exactly one root bone on a custom rig', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'custom',
      parts: [
        { name: 'A', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
        { name: 'B', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }
      ],
      skeleton: [
        { part: 'A', parent: 'HumanoidRootPart', joint: 'Root' },
        { part: 'B', parent: 'HumanoidRootPart', joint: 'Other' }
      ]
    })
    expect(
      problems.some((problem) =>
        problem.startsWith('skeleton: exactly one bone hangs from HumanoidRootPart')
      )
    ).toBe(true)
  })

  it('reports a cycle in a custom rig', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'custom',
      parts: [
        { name: 'A', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
        { name: 'B', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }
      ],
      skeleton: [
        { part: 'A', parent: 'HumanoidRootPart', joint: 'Root' },
        { part: 'B', parent: 'A', joint: 'Link' },
        { part: 'A', parent: 'B', joint: 'Back' }
      ]
    })
    expect(problems.some((problem) => problem.includes('a loop through'))).toBe(true)
  })

  it('validates bone axis, limits and joint name', () => {
    const problems = checkRig({
      category: 'character',
      rig: 'custom',
      parts: [{ name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }],
      skeleton: [
        {
          part: 'Body',
          parent: 'HumanoidRootPart',
          joint: '',
          axis: [1, 0] as unknown as number[],
          limits: [10, -10] as [number, number]
        }
      ]
    })
    expect(problems).toContain('skeleton[0].joint: a joint name is 1 to 40 characters')
    expect(problems).toContain('skeleton[0].axis: [x, y, z]: the main axis it bends about')
    expect(problems).toContain('skeleton[0].limits: [min, max] degrees')
  })
})

describe('normalizeSpec', () => {
  it('lets the tool call decide the category', () => {
    expect(normalizeSpec(R15_HERO, 'prop').category).toBe('prop')
  })

  it('drops accessoryType for a non-accessory', () => {
    const normalized = normalizeSpec({ ...R15_HERO, accessoryType: 'Hat' }, 'prop')
    expect(normalized.accessoryType).toBeUndefined()
  })

  it('drops rig, skeleton and motion for a non-character', () => {
    const normalized = normalizeSpec(DOG, 'prop')
    expect(normalized.rig).toBeUndefined()
    expect(normalized.skeleton).toBeUndefined()
    expect(normalized.motion).toBeUndefined()
  })

  it('defaults a character rig to R15', () => {
    expect(normalizeSpec({ ...R15_HERO, rig: undefined }, 'character').rig).toBe('R15')
  })

  it('leaves a valid character rig alone', () => {
    expect(normalizeSpec(DOG, 'character').rig).toBe('custom')
  })
})

describe('paramValues', () => {
  it('clamps an override into the declared range', () => {
    const values = paramValues({ params: { h: { value: 4, min: 1, max: 8 } } }, { h: 99 })
    expect(values.h).toBe(8)
  })

  it('falls back to the declared value', () => {
    expect(paramValues({ params: { h: { value: 4, min: 1, max: 8 } } }).h).toBe(4)
  })

  it('returns nothing for a spec with no params', () => {
    expect(paramValues(R15_HERO)).toEqual({})
  })
})
