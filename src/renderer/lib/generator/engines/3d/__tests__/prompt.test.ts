/**
 * The 3D system prompt: the regression that stops it going vague.
 *
 * The prompt text is re-authored (see the header of `prompt.ts`), so the only
 * defence against it drifting away from the engine is to assert what it must
 * contain. R1 in the plan is exactly this risk: a prompt that describes the
 * schema but carries no worked example produces worse models, the same failure
 * mode as clothing's D5.
 *
 * Two of these tests are the ones the plan names: the prompt contains the
 * literal strings "R15_HERO" and "DOG".
 */
import { describe, expect, it } from 'vitest'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import { DOG_EXAMPLE, R15_HERO_EXAMPLE } from '@/lib/generator/engines/3d/examples'
import { EXPR_FUNCTION_NAMES } from '@/lib/generator/engines/3d/expr'
import {
  CATEGORY_GUIDES,
  categoryGuide,
  firstMessage,
  MODEL_3D_SYSTEM_PROMPT,
  rigGuide
} from '@/lib/generator/engines/3d/prompt'
import {
  ACCESSORY_TYPES,
  BOOLEAN_OPS,
  CATEGORIES,
  LIMITS,
  NODE_TYPES,
  R6_JOINTS,
  R15_JOINTS,
  SHAPES,
  TEMPLATE_IDS,
  validateSpec
} from '@/lib/generator/engines/3d/schema'

const prompt = MODEL_3D_SYSTEM_PROMPT

describe('the regression the plan requires', () => {
  it('contains the literal string "R15_HERO"', () => {
    expect(prompt).toContain('R15_HERO')
  })

  it('contains the literal string "DOG"', () => {
    expect(prompt).toContain('DOG')
  })

  it('embeds both examples as complete JSON', () => {
    // The whole spec is serialised, so a model can copy a shape rather than
    // invent one from the field list.
    expect(prompt).toContain(JSON.stringify(R15_HERO_EXAMPLE))
    expect(prompt).toContain(JSON.stringify(DOG_EXAMPLE))
  })
})

describe('the two examples are valid specs', () => {
  it('R15_HERO validates and builds', () => {
    expect(validateSpec(R15_HERO_EXAMPLE)).toEqual([])
    const model = buildSpec(R15_HERO_EXAMPLE)
    expect(model.groups).toHaveLength(15)
  })

  it('DOG validates and builds', () => {
    expect(validateSpec(DOG_EXAMPLE)).toEqual([])
    const model = buildSpec(DOG_EXAMPLE)
    expect(model.groups).toHaveLength(11)
    expect(model.rigSpec?.skeleton).toHaveLength(11)
  })

  it('R15_HERO is the documented shape: 15 parts, 5 colours, no skeleton', () => {
    expect(R15_HERO_EXAMPLE.parts).toHaveLength(15)
    expect(Object.keys(R15_HERO_EXAMPLE.palette)).toHaveLength(5)
    expect(R15_HERO_EXAMPLE.skeleton).toBeUndefined()
    expect(R15_HERO_EXAMPLE.rig).toBe('R15')
  })

  it('DOG is the documented shape: custom rig, 11 bones', () => {
    expect(DOG_EXAMPLE.rig).toBe('custom')
    expect(DOG_EXAMPLE.skeleton).toHaveLength(11)
    expect(DOG_EXAMPLE.parts).toHaveLength(11)
  })

  it('DOG reuses the humanoid joint vocabulary on a quadruped', () => {
    const joints = (DOG_EXAMPLE.skeleton ?? []).map((bone) => bone.joint)
    expect(joints).toContain('FrontLeftShoulder')
    expect(joints).toContain('BackRightKnee')
  })
})

describe('the vocabulary the prompt must carry', () => {
  it('names all 16 node types', () => {
    for (const type of NODE_TYPES) {
      expect(prompt, type).toContain(type)
    }
  })

  it('lists all 8 shape types', () => {
    expect(SHAPES).toHaveLength(8)
    for (const shape of SHAPES) {
      expect(prompt, shape).toContain(shape)
    }
  })

  it('lists all 6 categories', () => {
    for (const category of CATEGORIES) {
      expect(prompt, category).toContain(category)
    }
  })

  it('lists all 8 accessory types', () => {
    for (const type of ACCESSORY_TYPES) {
      expect(prompt, type).toContain(type)
    }
  })

  it('lists the 3 boolean operations', () => {
    for (const op of BOOLEAN_OPS) {
      expect(prompt, op).toContain(op)
    }
  })

  it('lists all 8 expression functions', () => {
    expect(EXPR_FUNCTION_NAMES).toHaveLength(9)
    for (const fn of EXPR_FUNCTION_NAMES) {
      expect(prompt, fn).toContain(fn)
    }
  })

  it('names the template catalog', () => {
    for (const id of TEMPLATE_IDS) {
      expect(prompt, id).toContain(id)
    }
  })
})

describe('the J limits the prompt must state', () => {
  it('states the node cap', () => {
    expect(prompt).toContain(`at most ${LIMITS.nodes} nodes`)
  })

  it('states the depth cap', () => {
    expect(prompt).toContain(`at most ${LIMITS.depth} deep`)
  })

  it('states the boolean caps', () => {
    expect(prompt).toContain(`at most ${LIMITS.booleans} boolean nodes`)
    expect(prompt).toContain(`at most ${LIMITS.booleanTriangles} triangles`)
  })

  it('states the array, text, points and mesh caps', () => {
    expect(prompt).toContain(`at most ${LIMITS.arrayCount}`)
    expect(prompt).toContain(`at most ${LIMITS.text} characters`)
    expect(prompt).toContain(`at most ${LIMITS.points} points`)
    expect(prompt).toContain(`at most ${LIMITS.meshNumbers / 9} triangles`)
  })

  it('states the extent bound in studs', () => {
    expect(prompt).toContain(`at most ${LIMITS.extent * 10} in absolute value`)
  })

  it('states the palette caps', () => {
    expect(prompt).toContain('64 palette colours')
    expect(prompt).toContain('8 of them textured')
  })
})

describe('the rules a model gets wrong without being told', () => {
  it('says sin and cos take degrees', () => {
    expect(prompt).toContain('take DEGREES, not radians')
    expect(prompt).toContain('sin(90)')
  })

  it('says rotation is degrees in XYZ order', () => {
    expect(prompt).toMatch(/rotation\s+\[x, y, z\] DEGREES/)
    expect(prompt).toContain('XYZ order')
  })

  it('says colours are six-digit hex with no alpha', () => {
    expect(prompt).toContain('six hex digits, no names, no alpha')
  })

  it('says a missing $param is an error, not a zero', () => {
    expect(prompt).toContain('A missing parameter is an error, never a zero')
  })

  it('says there is no ^, ceil, tan, pi, comparison or ternary', () => {
    expect(prompt).toContain('no `^`')
    expect(prompt).toContain('no `ceil`')
    expect(prompt).toContain('no `tan`')
    expect(prompt).toContain('no `pi`')
  })

  it('says array.step is required when not radial', () => {
    expect(prompt).toContain('`step` is then required')
  })

  it('says the R6 names contain spaces', () => {
    expect(prompt).toContain('R6 names contain SPACES')
  })

  it('says capsule.length silently defaults to 0.5', () => {
    // Documented rather than hidden, because the validator does not require it.
    expect(prompt).toContain('length defaults to 0.5 if omitted')
  })

  it('says a boolean is the most expensive node and is capped', () => {
    expect(prompt).toContain('It is the most expensive node')
  })
})

describe('the axis convention', () => {
  it('states authoring at +Z front and +Y up', () => {
    expect(prompt).toContain('Author the model with the face at **+Z** and **+Y up**')
  })

  it('states that the export mirrors to -Z', () => {
    expect(prompt).toContain('front at **-Z**')
  })

  it('states that the model does not do the mirroring itself', () => {
    expect(prompt).toContain('You do not do that mirroring')
  })

  it('states that feet sit at y = 0', () => {
    expect(prompt).toContain('Feet sit at y = 0')
  })
})

describe('the rig tables', () => {
  it('lists every R15 canonical part with its parent and joint', () => {
    for (const joint of R15_JOINTS) {
      expect(prompt, joint.part).toContain(joint.part)
      expect(prompt, joint.joint).toContain(joint.joint)
    }
  })

  it('lists every R6 canonical part, spaces included', () => {
    for (const joint of R6_JOINTS) {
      expect(prompt, joint.part).toContain(joint.part)
    }
    expect(prompt).toContain('Left Arm')
    expect(prompt).toContain('Right Leg')
  })

  it('lists the accessory bounds table', () => {
    expect(prompt).toContain('3 x 4 x 3')
    expect(prompt).toContain('10 x 7 x 4.5')
    expect(prompt).toContain('HatAttachment')
    expect(prompt).toContain('WaistBackAttachment')
  })
})

describe('the placeholder names the original interpolated', () => {
  // 08 G1 lists the names the original's fill() call sites used. Carrying them
  // is what makes this prompt recognisably the same contract.
  it('covers the known placeholders as concepts', () => {
    const concepts = ['template', 'texture', 'example', 'attachment', 'bounds', 'rig', 'bones']
    for (const concept of concepts) {
      expect(prompt.toLowerCase(), concept).toContain(concept)
    }
  })
})

describe('the review and rejection protocol', () => {
  it('asks for one fenced json block and nothing else', () => {
    expect(prompt).toContain('exactly one fenced ```json block and nothing else')
  })

  it('names the two sheets a reviewer is shown', () => {
    expect(prompt).toContain('front, right side, back and three-quarter')
    expect(prompt).toContain('close-ups and a test walk')
  })

  it('tells the model to return the whole spec, never a patch', () => {
    expect(prompt).toContain('return the whole corrected spec')
    expect(prompt).toContain('never a patch, never an apology')
  })

  it('explains that a rejection names the field and the message', () => {
    expect(prompt).toContain('`field: message`')
  })
})

describe('categoryGuide', () => {
  it('has a guide for all 6 categories', () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_GUIDES[category], category).toBeTruthy()
      expect(categoryGuide(category)).toBe(CATEGORY_GUIDES[category])
    }
  })

  it('falls back to the prop guide for an unknown category', () => {
    expect(categoryGuide('weapon')).toBe(CATEGORY_GUIDES.prop)
  })

  it('mentions the UGC bounds for an accessory', () => {
    expect(categoryGuide('accessory')).toContain('UGC bounds')
    expect(categoryGuide('accessory')).toContain('4000 triangles')
  })

  it('says a building has no UGC bounds', () => {
    expect(categoryGuide('building')).toContain('No UGC bounds apply')
  })

  it('says a tool must stay under about 8 studs', () => {
    expect(categoryGuide('tool')).toContain('8 studs')
  })

  it('says a character part needs a name and a pivot', () => {
    expect(categoryGuide('character')).toContain('`name` and a `pivot`')
  })
})

describe('rigGuide', () => {
  it('tells an R15 character to use the canonical names and no skeleton', () => {
    const guide = rigGuide('R15')
    expect(guide).toContain('R15 canonical part names')
    expect(guide).toContain('Do not add a "skeleton"')
  })

  it('tells an R6 character the same', () => {
    expect(rigGuide('R6')).toContain('R6 canonical part names')
  })

  it('tells a custom rig to list every bone with one root', () => {
    const guide = rigGuide('custom')
    expect(guide).toContain('List every bone')
    expect(guide).toContain('Exactly one bone hangs from HumanoidRootPart')
    expect(guide).toContain('DOG example')
  })

  it('defaults to the R15 guide', () => {
    expect(rigGuide()).toContain('R15 canonical part names')
  })
})

describe('firstMessage', () => {
  it('opens a fresh accessory request with its slot', () => {
    const message = firstMessage({
      prompt: 'a pirate hat',
      category: 'accessory',
      accessoryType: 'Hat'
    })
    expect(message.startsWith('Design an accessory (Hat): a pirate hat')).toBe(true)
    expect(message).toContain('Category rules:')
  })

  it('opens a fresh character request with its rig', () => {
    const message = firstMessage({ prompt: 'a knight', category: 'character', rig: 'R15' })
    expect(message.startsWith('Design a rigged character (rig: R15): a knight')).toBe(true)
  })

  it('appends the rig guide only for a character', () => {
    expect(firstMessage({ prompt: 'a crate', category: 'prop' })).not.toContain('Rig guide:')
    expect(firstMessage({ prompt: 'a knight', category: 'character' })).toContain('Rig guide:')
  })

  it('opens a fresh prop request with a plain article', () => {
    expect(
      firstMessage({ prompt: 'a crate', category: 'prop' }).startsWith('Design a prop: a crate')
    ).toBe(true)
  })

  it('asks for the whole updated spec when editing', () => {
    const message = firstMessage({
      prompt: 'make it taller',
      category: 'prop',
      base: { version: 1, category: 'prop' }
    })
    expect(message).toContain('Return the whole updated spec')
    expect(message).toContain('Change: make it taller')
    expect(message).toContain(JSON.stringify({ version: 1, category: 'prop' }))
  })

  it('separates the parts with blank lines, as the original joins them', () => {
    const message = firstMessage({ prompt: 'a knight', category: 'character' })
    expect(message.split('\n\n')).toHaveLength(3)
  })
})
