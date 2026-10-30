/**
 * `buildSpec`: primitives, the CSG caps, repair, and determinism.
 *
 * The two fixtures are rebuilt from the same source loops as the schema tests,
 * so a spec that validates is also the spec that builds. The caps are asserted
 * with their exact messages because the model reads them.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  BUDGET_LIMITS,
  buildModel,
  buildSpec,
  countOpenEdges,
  dropDegenerate,
  facesOutward,
  fitBudget,
  flipWinding,
  ModelRejected,
  modelBounds,
  modelTriangles,
  repairGeometry,
  signedVolume
} from '@/lib/generator/engines/3d/build'
import type { ModelSpec, SpecNode } from '@/lib/generator/engines/3d/schema'

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

const prop = (parts: SpecNode[], extra: Partial<ModelSpec> = {}): ModelSpec => ({
  version: 1,
  category: 'prop',
  palette: { a: '#ffffff', b: '#ff0000' },
  parts,
  ...extra
})

describe('buildSpec - the two few-shot models', () => {
  it('builds R15_HERO with 15 groups and under 4000 triangles', () => {
    const model = buildSpec(R15_HERO)
    expect(model.groups).toHaveLength(15)
    expect(modelTriangles(model)).toBeGreaterThan(0)
    expect(modelTriangles(model)).toBeLessThan(4000)
  })

  it('keeps R15_HERO every part named, in spec order', () => {
    const model = buildSpec(R15_HERO)
    expect(model.groups.map((group) => group.name)).toEqual([
      'LowerTorso',
      'UpperTorso',
      'Head',
      'LeftUpperArm',
      'LeftLowerArm',
      'LeftHand',
      'LeftUpperLeg',
      'LeftLowerLeg',
      'LeftFoot',
      'RightUpperArm',
      'RightLowerArm',
      'RightHand',
      'RightUpperLeg',
      'RightLowerLeg',
      'RightFoot'
    ])
  })

  it('builds DOG with 11 groups and carries its rig spec', () => {
    const model = buildSpec(DOG)
    expect(model.groups).toHaveLength(11)
    expect(model.rigSpec?.rig).toBe('custom')
    expect(model.rigSpec?.skeleton).toHaveLength(11)
  })

  it('expands a mirrored group into two parts', () => {
    // The head's eye group is `mirror: 'x'`, so one node yields two boxes.
    const model = buildSpec({
      version: 1,
      category: 'prop',
      palette: { a: '#ffffff' },
      parts: [
        {
          type: 'group',
          mirror: 'x',
          children: [{ type: 'box', size: [1, 1, 1], position: [2, 0, 0] }]
        }
      ]
    })
    expect(model.parts).toHaveLength(2)
    const xs = model.parts
      .map((part) => {
        part.geometry.computeBoundingBox()
        return part.geometry.boundingBox?.getCenter(
          new (part.geometry.boundingBox.min.constructor as never)()
        )
      })
      .filter(Boolean)
    expect(xs).toHaveLength(2)
  })

  it('expands a non-radial array into count parts', () => {
    const model = buildSpec(
      prop([
        {
          type: 'group',
          array: { count: 3, step: [2, 0, 0] },
          children: [{ type: 'box', size: [1, 1, 1] }]
        }
      ])
    )
    expect(model.parts).toHaveLength(3)
    const bounds = modelBounds(model)
    // Three unit boxes stepped 2 apart span x from -0.5 to 4.5.
    expect(bounds.min[0]).toBeCloseTo(-0.5, 5)
    expect(bounds.max[0]).toBeCloseTo(4.5, 5)
  })

  it('expands a radial array around Y', () => {
    const model = buildSpec(
      prop([
        {
          type: 'group',
          array: { count: 4, radial: true },
          children: [{ type: 'box', size: [1, 1, 1], position: [2, 0, 0] }]
        }
      ])
    )
    expect(model.parts).toHaveLength(4)
  })

  it('skips hidden nodes only when asked', () => {
    const spec = prop([{ type: 'box', size: [1, 1, 1], hidden: true }])
    expect(buildSpec(spec).parts).toHaveLength(1)
    expect(buildSpec(spec, { skipHidden: true }).parts).toHaveLength(0)
  })
})

describe('buildSpec - all 12 primitives produce geometry', () => {
  const primitives: Record<string, SpecNode> = {
    box: { type: 'box', size: [1, 2, 3] },
    roundedBox: { type: 'roundedBox', size: [1, 1, 1], radius: 0.2 },
    sphere: { type: 'sphere', radius: 1 },
    cylinder: { type: 'cylinder', radius: 1, height: 2 },
    cone: { type: 'cone', radius: 1, height: 2 },
    torus: { type: 'torus', radius: 1, tube: 0.2 },
    capsule: { type: 'capsule', radius: 0.5, length: 1 },
    extrude: { type: 'extrude', shape: { type: 'rect', w: 2, h: 1 }, depth: 0.5 },
    lathe: {
      type: 'lathe',
      profile: [
        [0, 0],
        [1, 1],
        [0.5, 2]
      ]
    },
    tube: {
      type: 'tube',
      path: [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0]
      ],
      radius: 0.2
    },
    sweep: {
      type: 'sweep',
      shape: { type: 'circle', radius: 0.3 },
      path: [
        [0, 0, 0],
        [1, 1, 0]
      ]
    },
    text: { type: 'text', text: 'Hi', size: 1 }
  }

  for (const [name, node] of Object.entries(primitives)) {
    it(`builds ${name}`, () => {
      const model = buildSpec(prop([node]))
      expect(model.parts.length).toBeGreaterThan(0)
      expect(modelTriangles(model)).toBeGreaterThan(0)
      for (const part of model.parts) {
        const position = part.geometry.attributes.position
        for (let i = 0; i < position.count; i++) {
          expect(Number.isFinite(position.getX(i))).toBe(true)
          expect(Number.isFinite(position.getY(i))).toBe(true)
          expect(Number.isFinite(position.getZ(i))).toBe(true)
        }
      }
    })
  }

  it('builds all 8 shape types through extrude', () => {
    const shapes = [
      { type: 'rect', w: 1, h: 1 },
      { type: 'roundedRect', w: 1, h: 1, radius: 0.2 },
      { type: 'circle', radius: 0.5 },
      { type: 'polygon', sides: 5, radius: 0.5 },
      { type: 'star', points: 5, outer: 0.5, inner: 0.25 },
      { type: 'heart', size: 0.5 },
      { type: 'ring', outer: 0.5, inner: 0.3 },
      {
        type: 'points',
        points: [
          [0, 0],
          [1, 0],
          [1, 1]
        ]
      }
    ]
    for (const shape of shapes) {
      const model = buildSpec(prop([{ type: 'extrude', shape, depth: 0.2 }]))
      expect(modelTriangles(model), `shape ${shape.type}`).toBeGreaterThan(0)
    }
  })

  it('centres extruded text on its bounding box', () => {
    const model = buildSpec(prop([{ type: 'text', text: 'AB', size: 1 }]))
    const bounds = modelBounds(model)
    const centreX = (bounds.min[0] + bounds.max[0]) / 2
    const centreY = (bounds.min[1] + bounds.max[1]) / 2
    expect(centreX).toBeCloseTo(0, 4)
    expect(centreY).toBeCloseTo(0, 4)
  })

  it('caps a lathe profile with radius 0 at both ends', () => {
    // The cap prepends/appends a radius-0 point so the profile closes.
    const model = buildSpec(
      prop([
        {
          type: 'lathe',
          profile: [
            [0.5, 0],
            [1, 1],
            [0.5, 2]
          ]
        }
      ])
    )
    expect(countOpenEdges(model.parts[0].geometry)).toBe(0)
  })
})

describe('buildSpec - the boolean caps', () => {
  const twoBoxes = (): SpecNode => ({
    type: 'boolean',
    op: 'union',
    children: [
      { type: 'box', size: [1, 1, 1] },
      { type: 'box', size: [1, 1, 1], position: [0.5, 0, 0] }
    ]
  })

  it('unions two boxes into one part per colour', () => {
    const model = buildSpec(prop([twoBoxes()]))
    expect(model.parts.length).toBeGreaterThan(0)
    expect(modelTriangles(model)).toBeGreaterThan(0)
  })

  it('keeps both colours when the children differ', () => {
    const model = buildSpec(
      prop([
        {
          type: 'boolean',
          op: 'union',
          children: [
            { type: 'box', size: [1, 1, 1], color: 'a' },
            { type: 'box', size: [1, 1, 1], position: [0.5, 0, 0], color: 'b' }
          ]
        }
      ])
    )
    expect(new Set(model.parts.map((part) => part.color))).toEqual(new Set(['a', 'b']))
  })

  it('subtracts and intersects', () => {
    for (const op of ['subtract', 'intersect'] as const) {
      const model = buildSpec(
        prop([
          {
            type: 'boolean',
            op,
            children: [
              { type: 'box', size: [2, 2, 2] },
              { type: 'box', size: [1, 1, 1], position: [0.5, 0.5, 0.5] }
            ]
          }
        ])
      )
      expect(modelTriangles(model), op).toBeGreaterThan(0)
    }
  })

  it('throws when a boolean exceeds the child-triangle cap', () => {
    // 40 spheres at 352 triangles each is ~14 000, well over the 4000 cap.
    const spheres: SpecNode[] = Array.from({ length: 40 }, (_, i) => ({
      type: 'sphere',
      radius: 0.1,
      position: [i * 0.2, 0, 0]
    }))
    expect(() => buildSpec(prop([{ type: 'boolean', op: 'union', children: spheres }]))).toThrow(
      ModelRejected
    )

    try {
      buildSpec(prop([{ type: 'boolean', op: 'union', children: spheres }]))
      expect.unreachable('should have thrown')
    } catch (error) {
      const problems = (error as ModelRejected).problems
      expect(problems).toHaveLength(1)
      // The message names the op, the count, the cap, and what to do instead.
      expect(problems[0]).toMatch(/^union boolean: its children have \d+ triangles, over the 4000/)
      expect(problems[0]).toContain('cut with boxes and cylinders')
      expect(problems[0]).toContain('move detail outside the boolean')
    }
  })

  it('accepts a boolean just under the cap', () => {
    // 11 spheres is ~3872 triangles, under 4000.
    const spheres: SpecNode[] = Array.from({ length: 11 }, (_, i) => ({
      type: 'sphere',
      radius: 0.1,
      position: [i * 0.2, 0, 0]
    }))
    expect(() =>
      buildSpec(prop([{ type: 'boolean', op: 'union', children: spheres }]))
    ).not.toThrow()
  })
})

describe('buildSpec - ModelRejected carries .problems', () => {
  it('throws the validator problems unchanged', () => {
    try {
      buildSpec({ version: 2 } as ModelSpec)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRejected)
      const rejected = error as ModelRejected
      expect(Array.isArray(rejected.problems)).toBe(true)
      expect(rejected.problems).toContain('version: must be 1')
      // The message is the problems joined by newlines, as the original does.
      expect(rejected.message).toBe(rejected.problems.join('\n'))
    }
  })

  it('reports every problem at once, not just the first', () => {
    try {
      buildSpec({ version: 2, category: 'nope' } as ModelSpec)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ModelRejected).problems.length).toBeGreaterThan(2)
    }
  })
})

describe('buildSpec - expressions and transforms', () => {
  it('evaluates a scale given as an expression', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1], scale: 'sin(90)' }]))
    const bounds = modelBounds(model)
    // scale 1 leaves a unit box.
    expect(bounds.size[0]).toBeCloseTo(1, 5)
  })

  it('evaluates a per-axis scale array', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1], scale: [2, '1 + 1', 3] }]))
    const bounds = modelBounds(model)
    expect(bounds.size[0]).toBeCloseTo(2, 5)
    expect(bounds.size[1]).toBeCloseTo(2, 5)
    expect(bounds.size[2]).toBeCloseTo(3, 5)
  })

  it('binds $param through a clamped value', () => {
    const model = buildSpec({
      version: 1,
      category: 'prop',
      palette: { a: '#ffffff' },
      params: { w: { value: 2, min: 1, max: 4 } },
      parts: [{ type: 'box', size: ['$w', 1, 1] }]
    })
    expect(modelBounds(model).size[0]).toBeCloseTo(2, 5)
  })

  it('treats rotation as degrees, XYZ order', () => {
    // A 90-degree turn about Y swaps the x and z extents of a 2x1x1 box.
    const model = buildSpec(prop([{ type: 'box', size: [2, 1, 1], rotation: [0, 90, 0] }]))
    const bounds = modelBounds(model)
    expect(bounds.size[0]).toBeCloseTo(1, 4)
    expect(bounds.size[2]).toBeCloseTo(2, 4)
  })

  it('applies position and pivot independently', () => {
    const model = buildSpec(
      prop([{ type: 'box', size: [1, 1, 1], position: [5, 0, 0], pivot: [0, 9, 0] }])
    )
    // `pivot` only names the group hinge; it does not move the geometry.
    expect(modelBounds(model).min[0]).toBeCloseTo(4.5, 5)
    expect(model.groups[0].pivot).toEqual([0, 9, 0])
  })
})

describe('repair', () => {
  it('leaves a closed, correctly wound box alone', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const geometry = model.parts[0].geometry
    expect(countOpenEdges(geometry)).toBe(0)
    expect(signedVolume(geometry)).toBeGreaterThan(0)
    expect(model.health.flipped).toBe(0)
  })

  it('flips an inside-out box', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const geometry = model.parts[0].geometry.clone()
    flipWinding(geometry)
    expect(signedVolume(geometry)).toBeLessThan(0)

    const repaired = repairGeometry(geometry)
    expect(repaired.flipped).toBe(true)
    expect(signedVolume(repaired.geometry)).toBeGreaterThan(0)
  })

  it('counts open edges on an open shell', () => {
    const triangle = new THREE.BufferGeometry()
    triangle.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
    )
    // One triangle is three edges, each used exactly once.
    expect(countOpenEdges(triangle)).toBe(3)
    expect(signedVolume(triangle)).toBe(0)
  })

  it('drops degenerate triangles', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    const geometry = model.parts[0].geometry
    const before = geometry.attributes.position.count / 3

    // Collapse one triangle onto a point.
    const position = geometry.attributes.position
    position.setXYZ(1, position.getX(0), position.getY(0), position.getZ(0))

    const { dropped, geometry: cleaned } = dropDegenerate(geometry)
    expect(dropped).toBeGreaterThan(0)
    expect(cleaned.attributes.position.count / 3).toBeLessThan(before)
  })

  it('reports the centroid test as outward for a normal box', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(facesOutward(model.parts[0].geometry)).toBe(true)
  })
})

describe('fitBudget', () => {
  it('leaves a model already under budget untouched', async () => {
    const model = buildSpec(R15_HERO)
    const before = modelTriangles(model)
    await fitBudget(model, 100000)
    expect(modelTriangles(model)).toBe(before)
    expect(model.simplified).toBe(false)
  })

  it('simplifies a model over budget and flags it', async () => {
    const model = buildSpec(
      prop([
        { type: 'sphere', radius: 1 },
        { type: 'torus', radius: 1, tube: 0.3 }
      ])
    )
    const before = modelTriangles(model)
    expect(before).toBeGreaterThan(100)
    await fitBudget(model, 100)
    expect(modelTriangles(model)).toBeLessThanOrEqual(before)
    expect(model.simplified).toBe(true)
  })

  it('drops UVs on a simplified part, which is why it renders flat', async () => {
    const model = buildSpec(prop([{ type: 'sphere', radius: 1 }]))
    await fitBudget(model, 20)
    for (const part of model.parts) {
      expect(part.geometry.attributes.uv).toBeUndefined()
    }
  })
})

describe('buildModel', () => {
  it('fits the accessory budget with the documented margin', async () => {
    expect(BUDGET_LIMITS.accessory).toBe(3950)
    expect(BUDGET_LIMITS.other).toBe(19950)
  })

  it('returns a report with triangles, size and health', async () => {
    const built = await buildModel(R15_HERO)
    expect(built.report.ok).toBe(true)
    expect(built.report.issues).toEqual([])
    expect(typeof built.report.triangles).toBe('number')
    expect(Array.isArray(built.report.size)).toBe(true)
    expect(built.report.simplified).toBe(false)
    expect(built.model.groups).toHaveLength(15)
  })

  it('carries the built model, not just the spec', async () => {
    const built = await buildModel(DOG)
    expect(built.model.parts.length).toBeGreaterThan(0)
    expect(built.model.rigSpec?.rig).toBe('custom')
  })
})

describe('determinism', () => {
  it('builds the same spec to identical geometry twice', () => {
    const first = buildSpec(R15_HERO)
    const second = buildSpec(R15_HERO)

    expect(modelTriangles(first)).toBe(modelTriangles(second))
    expect(first.parts).toHaveLength(second.parts.length)

    first.parts.forEach((part, index) => {
      const a = part.geometry.attributes.position.array
      const b = second.parts[index].geometry.attributes.position.array
      expect(a.length).toBe(b.length)
      // Byte-identical, not merely close: no randomness anywhere in the build.
      expect(Array.from(a as Float32Array)).toEqual(Array.from(b as Float32Array))
    })
  })

  it('builds the same spec to identical geometry across two calls', async () => {
    const first = await buildModel(DOG)
    const second = await buildModel(DOG)
    expect(first.report.triangles).toBe(second.report.triangles)
    expect(first.report.size).toEqual(second.report.size)
  })
})
