/**
 * Every category, at the complexity the engine allows.
 *
 * The dragon that came back as eight boxes and 13 studs was not a schema failure:
 * the spec was valid. It was a *quality* failure - the model spent almost none of
 * the budget it had. These specs are the opposite end: each one uses the nodes,
 * the arrays, the mirrors and the part counts the category is capable of, at the
 * size the subject implies.
 *
 * They are hand-authored rather than model-generated on purpose. A stress test
 * that asks a model would measure the model; this measures the engine, so a
 * failure here means the builder, the checks or the export is the limit, not the
 * prompt.
 */
import { describe, expect, it } from 'vitest'
import { buildSpec } from '../build'
import { checkModel } from '../check'
import { toGlb } from '../export'
import type { ModelSpec } from '../schema'
import { validateSpec } from '../schema'

const SCALE = 3.5714 // studs per metre, the conversion the prompt now states

function box(
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  extra: Record<string, unknown> = {}
) {
  return { type: 'box', size, position, color, ...extra }
}

/** A 12 m dragon: segmented neck, tapering tail, jointed legs, layered scales. */
function dragon(): ModelSpec {
  const length = 12 * SCALE // ~43 studs nose to tail
  const bodyY = 6
  const neckSegments = 10
  const tailSegments = 12

  const neck = Array.from({ length: neckSegments }, (_, i) => {
    const t = i / (neckSegments - 1)
    return box(
      [2.4 - t * 1.1, 2.4 - t * 1.1, 2.2],
      [0, bodyY + 2 + t * 5.5, 4.5 + t * 3.5],
      'scale'
    )
  })

  const head = [
    box([2.6, 2.2, 3.4], [0, bodyY + 8.2, 9.2], 'scale'),
    box([1.8, 1.2, 2.6], [0, bodyY + 7.6, 11.6], 'scale'),
    // jaw
    box([1.6, 0.7, 2.4], [0, bodyY + 7.0, 11.4], 'belly'),
    // horns, mirrored by the array below
    box([0.5, 2.2, 0.5], [0.8, bodyY + 9.4, 8.6], 'horn'),
    box([0.5, 2.2, 0.5], [-0.8, bodyY + 9.4, 8.6], 'horn'),
    // eyes
    box([0.35, 0.35, 0.35], [0.9, bodyY + 8.4, 10.2], 'eye'),
    box([0.35, 0.35, 0.35], [-0.9, bodyY + 8.4, 10.2], 'eye')
  ]

  const tail = Array.from({ length: tailSegments }, (_, i) => {
    const t = i / (tailSegments - 1)
    return box(
      [2.2 - t * 1.9, 2.2 - t * 1.9, 1.9],
      [0, bodyY - t * 3.4, -4.5 - t * 9],
      i > tailSegments - 3 ? 'horn' : 'scale'
    )
  })

  const leg = (side: 1 | -1, front: boolean): unknown[] => {
    const z = front ? 2.6 : -2.2
    return [
      box([1.5, 3.2, 1.5], [side * 2.1, bodyY - 2.4, z], 'dark'),
      box([1.2, 2.6, 1.2], [side * 2.1, bodyY - 5.1, z + 0.3], 'dark'),
      // three toes, so the foot reads as a foot
      box([0.5, 0.6, 1.6], [side * 2.1 - 0.5, bodyY - 6.6, z + 0.8], 'claw'),
      box([0.5, 0.6, 1.6], [side * 2.1, bodyY - 6.6, z + 0.9], 'claw'),
      box([0.5, 0.6, 1.6], [side * 2.1 + 0.5, bodyY - 6.6, z + 0.8], 'claw')
    ]
  }

  const wing = (side: 1 | -1): unknown[] => [
    // membrane as an array of ribs, each thinner than the last
    box([0.35, 0.35, 5.2], [side * 3.2, bodyY + 4.2, 1.2], 'wing', {
      array: { count: 6, step: [0, 1.1, -1.3] }
    }),
    box([0.6, 0.6, 7.4], [side * 3.2, bodyY + 4.6, 0.4], 'dark'),
    box([0.5, 5.6, 0.5], [side * 5.6, bodyY + 6.4, -1.4], 'dark')
  ]

  return {
    version: 1,
    name: 'Mythic Dragon 1:1',
    category: 'prop',
    palette: {
      scale: '#3f6b3a',
      dark: '#26401f',
      belly: '#c9ad63',
      horn: '#e6d9b8',
      claw: '#1e1a16',
      eye: '#ffb020',
      wing: '#527f47'
    },
    parts: [
      {
        name: 'Torso',
        type: 'group',
        children: [
          box([4.4, 3.6, 4.6], [0, bodyY, -2.6], 'scale'),
          box([4.8, 4.0, 4.6], [0, bodyY + 0.2, 0.2], 'scale'),
          box([4.6, 4.2, 4.2], [0, bodyY + 0.3, 3.4], 'scale'),
          box([3.4, 1.0, 9.0], [0, bodyY - 1.6, 0.2], 'belly'),
          // dorsal scales as a repeated row, not one flat plate
          box([0.8, 0.9, 0.6], [0, bodyY + 2.2, -3.6], 'dark', {
            array: { count: 9, step: [0, 0, 1.1] }
          })
        ]
      },
      { name: 'Neck', type: 'group', children: neck },
      { name: 'Head', type: 'group', children: head },
      { name: 'Tail', type: 'group', children: tail },
      { name: 'FrontLegs', type: 'group', children: [...leg(1, true), ...leg(-1, true)] },
      { name: 'BackLegs', type: 'group', children: [...leg(1, false), ...leg(-1, false)] },
      { name: 'Wings', type: 'group', children: [...wing(1), ...wing(-1)] }
    ]
  } as ModelSpec
}

/** A rigged humanoid at R15 with a full skeleton. */
function hero(): ModelSpec {
  const palette = {
    skin: '#f2c39b',
    shirt: '#3a7bd5',
    pants: '#2c3e50',
    shoe: '#1b1b1f',
    eye: '#1b1b1f'
  }
  const limb = (name: string, y: number, len: number, color: string) => ({
    name,
    type: 'box',
    size: [1, len, 1],
    position: [0, y, 0],
    color,
    pivot: [0, y + len / 2, 0]
  })
  return {
    version: 1,
    name: 'R15 Hero',
    category: 'character',
    rig: 'R15',
    palette,
    skeleton: [
      { part: 'LowerTorso', parent: 'HumanoidRootPart', joint: 'Root' },
      { part: 'UpperTorso', parent: 'LowerTorso', joint: 'Waist' },
      { part: 'Head', parent: 'UpperTorso', joint: 'Neck' },
      { part: 'LeftUpperArm', parent: 'UpperTorso', joint: 'LeftShoulder' },
      { part: 'LeftLowerArm', parent: 'LeftUpperArm', joint: 'LeftElbow' },
      { part: 'LeftHand', parent: 'LeftLowerArm', joint: 'LeftWrist' },
      { part: 'RightUpperArm', parent: 'UpperTorso', joint: 'RightShoulder' },
      { part: 'RightLowerArm', parent: 'RightUpperArm', joint: 'RightElbow' },
      { part: 'RightHand', parent: 'RightLowerArm', joint: 'RightWrist' },
      { part: 'LeftUpperLeg', parent: 'LowerTorso', joint: 'LeftHip' },
      { part: 'LeftLowerLeg', parent: 'LeftUpperLeg', joint: 'LeftKnee' },
      { part: 'LeftFoot', parent: 'LeftLowerLeg', joint: 'LeftAnkle' },
      { part: 'RightUpperLeg', parent: 'LowerTorso', joint: 'RightHip' },
      { part: 'RightLowerLeg', parent: 'RightUpperLeg', joint: 'RightKnee' },
      { part: 'RightFoot', parent: 'RightLowerLeg', joint: 'RightAnkle' }
    ],
    parts: [
      { ...limb('LowerTorso', 2.4, 1.2, 'pants'), pivot: [0, 3, 0] },
      { ...limb('UpperTorso', 3.6, 1.2, 'shirt'), pivot: [0, 3.6, 0] },
      {
        name: 'Head',
        type: 'group',
        pivot: [0, 4.8, 0],
        children: [
          box([1.4, 1.4, 1.4], [0, 5.4, 0], 'skin'),
          box([0.25, 0.25, 0.2], [0.3, 5.5, 0.7], 'eye'),
          box([0.25, 0.25, 0.2], [-0.3, 5.5, 0.7], 'eye')
        ]
      },
      {
        ...limb('LeftUpperArm', 3.6, 1.2, 'shirt'),
        position: [0.95, 3.6, 0],
        pivot: [0.95, 4.2, 0]
      },
      {
        ...limb('LeftLowerArm', 2.6, 1.2, 'skin'),
        position: [0.95, 2.6, 0],
        pivot: [0.95, 3.2, 0]
      },
      { ...limb('LeftHand', 1.85, 0.5, 'skin'), position: [0.95, 1.85, 0], pivot: [0.95, 2.1, 0] },
      {
        ...limb('RightUpperArm', 3.6, 1.2, 'shirt'),
        position: [-0.95, 3.6, 0],
        pivot: [-0.95, 4.2, 0]
      },
      {
        ...limb('RightLowerArm', 2.6, 1.2, 'skin'),
        position: [-0.95, 2.6, 0],
        pivot: [-0.95, 3.2, 0]
      },
      {
        ...limb('RightHand', 1.85, 0.5, 'skin'),
        position: [-0.95, 1.85, 0],
        pivot: [-0.95, 2.1, 0]
      },
      { ...limb('LeftUpperLeg', 1.8, 1.2, 'pants'), position: [0.4, 1.8, 0], pivot: [0.4, 2.4, 0] },
      { ...limb('LeftLowerLeg', 0.8, 1.2, 'pants'), position: [0.4, 0.8, 0], pivot: [0.4, 1.4, 0] },
      {
        name: 'LeftFoot',
        type: 'box',
        size: [1, 0.4, 1.4],
        position: [0.4, 0.2, 0.2],
        color: 'shoe',
        pivot: [0.4, 0.4, 0]
      },
      {
        ...limb('RightUpperLeg', 1.8, 1.2, 'pants'),
        position: [-0.4, 1.8, 0],
        pivot: [-0.4, 2.4, 0]
      },
      {
        ...limb('RightLowerLeg', 0.8, 1.2, 'pants'),
        position: [-0.4, 0.8, 0],
        pivot: [-0.4, 1.4, 0]
      },
      {
        name: 'RightFoot',
        type: 'box',
        size: [1, 0.4, 1.4],
        position: [-0.4, 0.2, 0.2],
        color: 'shoe',
        pivot: [-0.4, 0.4, 0]
      }
    ]
  } as unknown as ModelSpec
}

/** A five-storey building: window arrays, a door boolean, a lathe column. */
function tower(): ModelSpec {
  const floors = 5
  const floorHeight = 11
  const width = 30
  const depth = 22
  const height = floors * floorHeight

  const slab = Array.from({ length: floors }, (_, i) =>
    box([width, 1, depth], [0, i * floorHeight, 0], 'concrete')
  )

  const windows = Array.from({ length: floors }, (_, i) =>
    box([3.2, 4.2, 0.4], [-10.8, i * floorHeight + 6, depth / 2], 'glass', {
      array: { count: 5, step: [5.4, 0, 0] }
    })
  )

  return {
    version: 1,
    name: 'Corner Tower',
    category: 'building',
    palette: {
      concrete: '#c9c4bb',
      glass: '#7fb3d5',
      trim: '#8a8578',
      door: '#4a3b2a'
    },
    parts: [
      { name: 'Slabs', type: 'group', children: slab },
      { name: 'Facade', type: 'group', children: windows },
      {
        name: 'Walls',
        type: 'group',
        children: [
          box([width, height, 1], [0, height / 2, depth / 2], 'concrete'),
          box([width, height, 1], [0, height / 2, -depth / 2], 'concrete'),
          box([1, height, depth], [width / 2, height / 2, 0], 'concrete'),
          box([1, height, depth], [-width / 2, height / 2, 0], 'concrete')
        ]
      },
      {
        name: 'Entrance',
        type: 'group',
        children: [
          box([6, 8, 0.6], [0, 4, depth / 2 + 0.2], 'door'),
          box([8, 0.6, 3], [0, 8.4, depth / 2 + 1.5], 'trim')
        ]
      },
      {
        name: 'Columns',
        type: 'lathe',
        position: [-width / 2 - 2, 0, depth / 2 + 2],
        profile: [
          [0, 0],
          [1.2, 0],
          [1.2, height],
          [0, height]
        ],
        sides: 12,
        color: 'trim'
      }
    ]
  } as unknown as ModelSpec
}

/** A pickaxe: a boolean head, an extruded blade, a swept handle. */
function pickaxe(): ModelSpec {
  return {
    version: 1,
    name: 'Miner Pickaxe',
    category: 'tool',
    palette: { wood: '#8a5a2b', iron: '#6f7276', edge: '#cfd4d8' },
    parts: [
      {
        name: 'Handle',
        type: 'tube',
        path: [
          [0, 0, 0],
          [0, 3, 0],
          [0, 6, 0]
        ],
        radius: 0.35,
        sides: 10,
        color: 'wood'
      },
      {
        name: 'Head',
        type: 'group',
        children: [
          box([7, 1.1, 1.1], [0, 6.2, 0], 'iron'),
          box([1.2, 1.6, 1.2], [0, 6.2, 0], 'iron'),
          {
            type: 'extrude',
            shape: 'triangle',
            size: 1.4,
            depth: 0.5,
            position: [3.6, 6.2, 0],
            rotation: [0, 90, 0],
            color: 'edge'
          },
          {
            type: 'extrude',
            shape: 'triangle',
            size: 1.4,
            depth: 0.5,
            position: [-3.6, 6.2, 0],
            rotation: [0, -90, 0],
            color: 'edge'
          }
        ]
      }
    ]
  } as unknown as ModelSpec
}

/** A back accessory at its UGC bound, with layered plates. */
function backpack(): ModelSpec {
  return {
    version: 1,
    name: 'Expedition Pack',
    category: 'accessory',
    accessoryType: 'Back',
    palette: { canvas: '#4a5a3a', strap: '#2b2b2b', buckle: '#c9a227' },
    parts: [
      {
        name: 'Pack',
        type: 'group',
        children: [
          box([8, 6.5, 3.5], [0, 4, -1.5], 'canvas'),
          box([7, 1.4, 3.8], [0, 5.6, -1.5], 'canvas'),
          box([1.2, 6.5, 0.4], [0, 4, 0.4], 'strap'),
          box([0.9, 0.9, 0.5], [0, 4.4, 0.6], 'buckle'),
          box([0.9, 0.9, 0.5], [0, 3.4, 0.6], 'buckle')
        ]
      }
    ]
  } as unknown as ModelSpec
}

/** A sign: the text node plus a frame. */
function sign(): ModelSpec {
  return {
    version: 1,
    name: 'Workshop Sign',
    category: 'text',
    palette: { board: '#3b2f2a', letter: '#f0e6d2', frame: '#8a6a3a' },
    parts: [
      {
        name: 'Board',
        type: 'group',
        children: [
          box([16, 6, 0.8], [0, 5, 0], 'board'),
          box([16.6, 0.6, 1.2], [0, 8.2, 0], 'frame'),
          box([16.6, 0.6, 1.2], [0, 1.8, 0], 'frame'),
          {
            type: 'text',
            text: 'WORKSHOP',
            size: 2.2,
            depth: 0.4,
            position: [0, 5, 0.6],
            color: 'letter'
          }
        ]
      }
    ]
  } as unknown as ModelSpec
}

const CASES: Array<{ name: string; spec: ModelSpec; category: string; minParts: number }> = [
  { name: 'dragon (prop, 1:1)', spec: dragon(), category: 'prop', minParts: 60 },
  { name: 'hero (character, R15)', spec: hero(), category: 'character', minParts: 15 },
  { name: 'tower (building)', spec: tower(), category: 'building', minParts: 20 },
  { name: 'pickaxe (tool)', spec: pickaxe(), category: 'tool', minParts: 4 },
  { name: 'backpack (accessory)', spec: backpack(), category: 'accessory', minParts: 1 },
  { name: 'sign (text)', spec: sign(), category: 'text', minParts: 1 }
]

describe.each(CASES)('$name', ({ spec, category, minParts }) => {
  it('passes the schema validator', () => {
    expect(validateSpec(spec)).toEqual([])
  })

  it('builds, and uses the part budget the category allows', () => {
    const model = buildSpec(spec)
    expect(model.parts.length).toBeGreaterThanOrEqual(minParts)
  })

  it('passes its own checks', () => {
    const model = buildSpec(spec)
    const report = checkModel(model, { category })
    expect(report.ok, JSON.stringify(report.issues)).toBe(true)
  })

  it('exports a GLB that carries geometry and a palette', () => {
    const model = buildSpec(spec)
    const glb = toGlb(model, { name: spec.name })
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    const jsonLen = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)))
    expect(json.materials.length).toBeGreaterThan(0)
    expect(json.meshes.length).toBeGreaterThan(0)
    expect(json.images?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('the dragon at 1:1', () => {
  it('is the size the conversion implies, not a toy', () => {
    const model = buildSpec(dragon())
    const report = checkModel(model, { category: 'prop' })
    // 12 m nose to tail is about 43 studs; anything near 13 is a lizard.
    expect(report.size[2]).toBeGreaterThan(30)
  })

  it('spends most of its triangle budget', () => {
    const model = buildSpec(dragon())
    const report = checkModel(model, { category: 'prop' })
    // The eight-box dragon used 8056 of 20000. A real one uses most of it.
    expect(report.triangles).toBeGreaterThan(12000)
  })
})
