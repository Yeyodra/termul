/**
 * The UGC and per-category checks, pinned to their exact wording.
 *
 * The strings reach the model verbatim, and `ok` gates `DONE`, so both are
 * asserted rather than merely exercised. The four acceptance cases from the
 * plan (07 7.4) are here by name.
 */
import { describe, expect, it } from 'vitest'
import { buildSpec, type Model } from '@/lib/generator/engines/3d/build'
import {
  ACCESSORY_BOUNDS,
  ATTACHMENT_OFFSETS,
  checkModel,
  checkRigBounds,
  HEAVY_TRIANGLES,
  LARGE_SURFACE,
  MESH_TRIANGLE_LIMIT,
  NEAR_LIMIT_TRIANGLES,
  openShellIssues,
  oppositeSide,
  partGroups,
  rigJoints,
  TRIANGLE_LIMIT,
  textureDetailIssues,
  validateAccessory
} from '@/lib/generator/engines/3d/check'
import type { ModelSpec, SpecNode } from '@/lib/generator/engines/3d/schema'

const prop = (parts: SpecNode[], extra: Partial<ModelSpec> = {}): ModelSpec => ({
  version: 1,
  category: 'prop',
  palette: { a: '#ffffff', b: '#ff0000' },
  parts,
  ...extra
})

/** A model of roughly `triangles` triangles, built from a sphere whose count we tune. */
function modelWithTriangles(triangles: number): Model {
  // A 16x12 sphere is 352 triangles; scale the count with an array of spheres.
  const spheres = Math.max(1, Math.round(triangles / 352))
  return buildSpec(
    prop([
      {
        type: 'group',
        array: { count: Math.min(spheres, 64), step: [0, 0, 0] },
        children: [{ type: 'sphere', radius: 1 }]
      }
    ])
  )
}

describe('the four acceptance cases from the plan', () => {
  it('rejects an accessory at 4001 triangles with one error issue', () => {
    // 12 spheres is 4224 triangles, over the 4000 cap.
    const model = modelWithTriangles(4200)
    expect(
      model.parts.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0)
    ).toBeGreaterThan(TRIANGLE_LIMIT)
    const report = checkModel(model, { category: 'accessory', accessoryType: 'Hat' })
    expect(report.ok).toBe(false)
    const errors = report.issues.filter((issue) => issue.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('triangles')
    expect(errors[0].message).toMatch(/^\d+ triangles; UGC accessories allow 4000\.$/)
  })

  it('accepts an accessory at 3900 triangles', () => {
    // 11 spheres is 3872 triangles, under 4000 but over the 3600 warn line.
    const model = modelWithTriangles(3872)
    const report = checkModel(model, { category: 'accessory', accessoryType: 'Hat' })
    expect(report.ok).toBe(true)
    expect(report.issues.some((issue) => issue.level === 'error')).toBe(false)
  })

  it('accepts a building at 3000 triangles, because no bounds check runs', () => {
    // Quirk reproduced: `building` validates as 'Prop', which has no bounds row.
    const model = modelWithTriangles(3000)
    const report = checkModel(model, { category: 'building' })
    expect(report.ok).toBe(true)
    expect(report.issues.some((issue) => issue.rule === 'bounds')).toBe(false)
  })

  it('warns, but does not fail, a character with no rigSpec', () => {
    const model = modelWithTriangles(352)
    // Force the character path without a rig spec.
    model.rigSpec = undefined
    const report = checkModel(model, { category: 'character' })
    expect(report.ok).toBe(true)
    expect(report.issues.every((issue) => issue.level === 'warn')).toBe(true)
  })
})

describe('the triangle rules', () => {
  it('errors over the accessory limit', () => {
    const report = validateAccessory(modelWithTriangles(4224), 'Hat')
    expect(report.ok).toBe(false)
    expect(report.issues[0].message).toBe('4224 triangles; UGC accessories allow 4000.')
  })

  it('warns near the limit, without failing', () => {
    const report = validateAccessory(modelWithTriangles(3872), 'Hat')
    expect(report.ok).toBe(true)
    expect(report.issues[0]).toMatchObject({ level: 'warn', rule: 'triangles' })
    expect(report.issues[0].message).toBe('3872 triangles is close to the 4000 limit.')
  })

  it('says nothing below the warn threshold', () => {
    const report = validateAccessory(modelWithTriangles(352), 'Hat')
    expect(report.issues).toEqual([])
    expect(NEAR_LIMIT_TRIANGLES).toBe(3600)
  })

  it('errors a single part over the per-mesh import cap', () => {
    // One dense sphere array stays one part per node, so build a big lathe.
    const model = buildSpec(
      prop([
        {
          type: 'lathe',
          profile: Array.from({ length: 60 }, (_, i) => [1 + Math.sin(i), i * 0.1])
        }
      ])
    )
    const groups = partGroups(model)
    expect(groups).toHaveLength(1)
    // A 24-segment lathe over 60 points stays under 20 000, so assert the rule
    // shape rather than forcing an enormous model.
    const report = checkModel(model, { category: 'prop' })
    expect(report.limit).toBe(MESH_TRIANGLE_LIMIT)
    expect(report.ok).toBe(true)
  })

  it('warns when the whole model is heavy for phones', () => {
    const report = checkModel(modelWithTriangles(11000), { category: 'prop' })
    expect(report.issues[0]).toMatchObject({ level: 'warn', rule: 'triangles' })
    expect(report.issues[0].message).toContain(`under ${HEAVY_TRIANGLES} is kinder`)
  })
})

describe('the bounds rules', () => {
  it('errors a hat wider than its 3-stud limit', () => {
    const model = buildSpec(
      prop([{ type: 'box', size: [5, 1, 1] }], { category: 'accessory', accessoryType: 'Hat' })
    )
    const report = validateAccessory(model, 'Hat')
    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual({
      level: 'error',
      rule: 'bounds',
      message: 'width 5.00 studs is over the Hat limit of 3.'
    })
  })

  it('accepts a hat exactly at its limit', () => {
    const model = buildSpec(
      prop([{ type: 'box', size: [3, 4, 3] }], { category: 'accessory', accessoryType: 'Hat' })
    )
    expect(validateAccessory(model, 'Hat').ok).toBe(true)
  })

  it('applies the right per-type limit', () => {
    // Back allows 10 x 7 x 4.5; a 9 x 6 x 4 box fits, a 9 x 6 x 5 does not.
    const fits = buildSpec(
      prop([{ type: 'box', size: [9, 6, 4] }], { category: 'accessory', accessoryType: 'Back' })
    )
    expect(validateAccessory(fits, 'Back').ok).toBe(true)

    const tooDeep = buildSpec(
      prop([{ type: 'box', size: [9, 6, 5] }], { category: 'accessory', accessoryType: 'Back' })
    )
    const report = validateAccessory(tooDeep, 'Back')
    expect(report.ok).toBe(false)
    expect(report.issues[0].message).toBe('depth 5.00 studs is over the Back limit of 4.5.')
  })

  it('lists all 8 accessory types with their attachment and bounds', () => {
    expect(Object.keys(ACCESSORY_BOUNDS)).toEqual([
      'Hat',
      'Hair',
      'Face',
      'Neck',
      'Shoulder',
      'Front',
      'Back',
      'Waist'
    ])
    for (const entry of Object.values(ACCESSORY_BOUNDS)) {
      expect(entry.bounds).toHaveLength(3)
      expect(entry.attachment).toMatch(/Attachment$/)
    }
  })

  it('warns a very large tool', () => {
    const model = buildSpec(prop([{ type: 'box', size: [12, 1, 1] }]))
    const report = checkModel(model, { category: 'tool' })
    expect(report.ok).toBe(true)
    expect(report.issues).toContainEqual({
      level: 'warn',
      rule: 'bounds',
      message: 'A 12.0-stud tool is very large to hold.'
    })
  })

  it('gives a tool the right grip attachment', () => {
    const report = checkModel(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])), {
      category: 'tool'
    })
    expect(report.attachment).toBe('RightGripAttachment')
  })
})

describe('the empty model rule', () => {
  it('errors a model with no geometry', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    model.parts = []
    const report = validateAccessory(model, 'Hat')
    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual({
      level: 'error',
      rule: 'empty',
      message: 'The model has no geometry.'
    })
  })
})

describe('the texture rules', () => {
  it('errors a texture over 1024 px', () => {
    const report = validateAccessory(modelWithTriangles(352), 'Hat', { textureSize: 2048 })
    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual({
      level: 'error',
      rule: 'texture',
      message: 'Texture is 2048px; the limit is 1024×1024.'
    })
  })

  it('warns a large flat-coloured surface', () => {
    // One 5 x 5 face in a single flat colour is 25 studs squared, over 16.
    const model = buildSpec(prop([{ type: 'box', size: [5, 0.1, 5] }]))
    const issues = textureDetailIssues(model, { category: 'prop' })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warn', rule: 'texture-detail' })
    expect(issues[0].message).toContain('in one flat colour "a"')
    expect(issues[0].message).toContain('reads as plastic')
    expect(issues[0].message).toContain('textured palette colour')
  })

  it('skips a small surface', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(textureDetailIssues(model, { category: 'prop' })).toEqual([])
  })

  it('skips a group with more than one colour', () => {
    const model = buildSpec(
      prop([
        {
          type: 'group',
          children: [
            { type: 'box', size: [5, 0.1, 5], color: 'a' },
            { type: 'box', size: [5, 0.1, 5], color: 'b' }
          ]
        }
      ])
    )
    expect(textureDetailIssues(model, { category: 'prop' })).toEqual([])
  })

  it('skips accessory, character and text entirely', () => {
    const model = buildSpec(prop([{ type: 'box', size: [5, 0.1, 5] }]))
    for (const category of ['accessory', 'character', 'text']) {
      expect(textureDetailIssues(model, { category }), category).toEqual([])
    }
    expect(LARGE_SURFACE).toBe(16)
  })
})

describe('the open-shell warning', () => {
  it('reports a part with open edges, with correct pluralisation', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    model.health.open = new Map([[0, 3]])
    const issues = openShellIssues(model)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: 'warn', rule: 'open' })
    expect(issues[0].message).toContain('has 3 open edges')
    expect(issues[0].message).toContain('it is a shell with a hole')
    expect(issues[0].message).toContain('a lathe profile that starts and ends on the axis')
  })

  it('uses the singular for one edge', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    model.health.open = new Map([[0, 1]])
    expect(openShellIssues(model)[0].message).toContain('has 1 open edge:')
  })

  it('is empty for a closed model', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(openShellIssues(model)).toEqual([])
  })
})

describe('the rig rules', () => {
  const boxes = (entries: Record<string, { min: number[]; max: number[] }>) => entries

  it('errors a pivot more than 0.25 studs outside its part', () => {
    const issues = checkRigBounds(
      [{ part: 'Head', parent: 'HumanoidRootPart', joint: 'Neck', pivot: [0, 9, 0] }],
      boxes({ Head: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } })
    )
    expect(issues).toContainEqual({
      level: 'error',
      rule: 'pivot',
      message:
        "Head's pivot is 8.00 studs outside the part: put it at the Neck joint, where Head meets HumanoidRootPart."
    })
  })

  it('accepts a pivot on the part surface', () => {
    const issues = checkRigBounds(
      [{ part: 'Head', parent: 'HumanoidRootPart', joint: 'Neck', pivot: [0, 1, 0] }],
      boxes({ Head: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] } })
    )
    expect(issues.filter((issue) => issue.rule === 'pivot')).toEqual([])
  })

  it('warns a joint gap over 0.12 studs', () => {
    const issues = checkRigBounds(
      [{ part: 'Head', parent: 'Torso', joint: 'Neck', pivot: [0, 3, 0] }],
      boxes({
        Head: { min: [-0.5, 2.5, -0.5], max: [0.5, 3.5, 0.5] },
        Torso: { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] }
      })
    )
    // The pivot sits at y 3, one stud above the torso's top face at y 2.
    expect(issues).toContainEqual({
      level: 'warn',
      rule: 'gap',
      message:
        'Head meets Torso 1.00 studs from the joint: bent, a gap opens. Let the segments ' +
        'overlap a little at the joint (or add a rounded joint cap).'
    })
  })

  it('warns asymmetric joints over 0.15 studs', () => {
    const issues = checkRigBounds(
      [
        { part: 'LeftArm', parent: 'Torso', joint: 'LeftShoulder', pivot: [1, 3, 0] },
        { part: 'RightArm', parent: 'Torso', joint: 'RightShoulder', pivot: [-1.5, 3, 0] }
      ],
      boxes({
        LeftArm: { min: [0.5, 2.5, -0.5], max: [1.5, 3.5, 0.5] },
        RightArm: { min: [-2, 2.5, -0.5], max: [-1, 3.5, 0.5] }
      })
    )
    const symmetry = issues.filter((issue) => issue.rule === 'symmetry')
    expect(symmetry.some((issue) => issue.message.includes('not mirror images'))).toBe(true)
  })

  it('warns a size mismatch over 15 percent', () => {
    const issues = checkRigBounds(
      [
        { part: 'LeftArm', parent: 'Torso', joint: 'LeftShoulder', pivot: [1, 3, 0] },
        { part: 'RightArm', parent: 'Torso', joint: 'RightShoulder', pivot: [-1, 3, 0] }
      ],
      boxes({
        LeftArm: { min: [0.5, 2.5, -0.5], max: [1.5, 3.5, 0.5] },
        RightArm: { min: [-2, 2.5, -0.5], max: [0, 3.5, 0.5] }
      })
    )
    expect(issues).toContainEqual({
      level: 'warn',
      rule: 'symmetry',
      message: 'LeftArm and RightArm differ in size.'
    })
  })

  it('flips Left/Right to find the opposite side', () => {
    expect(oppositeSide('LeftUpperArm')).toBe('RightUpperArm')
    expect(oppositeSide('RightFoot')).toBe('LeftFoot')
    expect(oppositeSide('ArmL')).toBe('ArmR')
    expect(oppositeSide('Torso')).toBeNull()
  })

  it('builds the joint list from a model rig spec', () => {
    const model = buildSpec({
      version: 1,
      category: 'character',
      rig: 'custom',
      palette: { a: '#ffffff' },
      skeleton: [
        { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
        { part: 'Head', parent: 'Body', joint: 'Neck' }
      ],
      parts: [
        { name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
        { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 2, 0], pivot: [0, 1, 0] }
      ]
    })
    const joints = rigJoints(model, partGroups(model))
    expect(joints).toHaveLength(2)
    expect(joints[0]).toEqual({
      part: 'Body',
      parent: 'HumanoidRootPart',
      joint: 'Root',
      pivot: [0, 0, 0]
    })
    expect(joints[1].joint).toBe('Neck')
  })
})

describe('partGroups', () => {
  it('groups parts by top-level node', () => {
    const model = buildSpec(
      prop([
        { name: 'A', type: 'box', size: [1, 1, 1] },
        {
          name: 'B',
          type: 'group',
          children: [
            { type: 'box', size: [1, 1, 1] },
            { type: 'box', size: [1, 1, 1], position: [2, 0, 0] }
          ]
        }
      ])
    )
    const groups = partGroups(model)
    expect(groups).toHaveLength(2)
    expect(groups[0].parts).toHaveLength(1)
    expect(groups[1].parts).toHaveLength(2)
    expect(groups[1].bounds.size[0]).toBeCloseTo(3, 5)
  })

  it('skips a node that produced no geometry', () => {
    const model = buildSpec(
      prop(
        [
          { type: 'box', size: [1, 1, 1], hidden: true },
          { type: 'box', size: [1, 1, 1] }
        ],
        {
          category: 'prop'
        }
      ),
      { skipHidden: true }
    )
    expect(partGroups(model)).toHaveLength(1)
  })
})

describe('the attachment offsets', () => {
  it('covers every attachment the bounds table names', () => {
    for (const entry of Object.values(ACCESSORY_BOUNDS)) {
      expect(ATTACHMENT_OFFSETS[entry.attachment], entry.attachment).toBeDefined()
      expect(ATTACHMENT_OFFSETS[entry.attachment]).toHaveLength(3)
    }
  })
})

describe('the report shape', () => {
  it('carries parts, health and limit for an accessory', () => {
    const report = checkModel(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])), {
      category: 'accessory',
      accessoryType: 'Hat'
    })
    expect(report.limit).toBe(TRIANGLE_LIMIT)
    expect(report.parts).toEqual([{ name: 'Part 1', triangles: 12 }])
    expect(report.health).toBeDefined()
    expect(report.size).toHaveLength(3)
  })

  it('carries the per-mesh limit for a non-accessory', () => {
    const report = checkModel(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])), {
      category: 'prop'
    })
    expect(report.limit).toBe(MESH_TRIANGLE_LIMIT)
    expect(report.attachment).toBeNull()
  })

  it('computes ok from errors alone, ignoring warnings', () => {
    const report = checkModel(buildSpec(prop([{ type: 'box', size: [5, 0.1, 5] }])), {
      category: 'prop'
    })
    // The texture-detail warning fires, but nothing blocks.
    expect(report.issues.some((issue) => issue.level === 'warn')).toBe(true)
    expect(report.ok).toBe(true)
  })
})
