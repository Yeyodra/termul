/**
 * The two in-binary few-shot examples, `R15_HERO` and `DOG`.
 *
 * These are the *only* spec examples that survive in the bundle
 * (`engine-DoiMMBHL.js:253-486`) and they are interpolated into the rig guide
 * as `{{example}}` (`gen3d-BAdfthxw.js:552-563`). They are the quality bar: a
 * prompt that describes the schema but shows no worked example produces worse
 * models, for the same reason the clothing prompt without `trim`/`shape`
 * produced flat garments.
 *
 * Both are rebuilt here from their source loops rather than pasted as expanded
 * JSON, so the expansion is exercised. `__tests__/schema.test.ts` asserts that
 * both validate with zero problems and that `R15_HERO` is 15 parts and `DOG` is
 * 11 bones, which is the regression that keeps this file honest.
 */
import type { ModelSpec, SpecNode } from './schema'

/** `Left`/`Right` prefix, from `M` (`engine-DoiMMBHL.js:252`). */
const limbName = (sign: number, suffix: string) => `${sign > 0 ? 'Left' : 'Right'}${suffix}`

/** `N()` — the 15-part R15 humanoid (`engine-DoiMMBHL.js:253-336`). */
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
        name: limbName(sign, 'UpperArm'),
        type: 'box',
        size: [1, 1, 1],
        position: [x, 3.5, 0],
        color: 'shirt',
        pivot: [sign * 1, 3.75, 0]
      },
      {
        name: limbName(sign, 'LowerArm'),
        type: 'box',
        size: [1, 0.85, 1],
        position: [x, 2.625, 0],
        color: 'skin',
        pivot: [x, 3, 0]
      },
      {
        name: limbName(sign, 'Hand'),
        type: 'box',
        size: [1, 0.25, 1],
        position: [x, 2.125, 0],
        color: 'skin',
        pivot: [x, 2.2, 0]
      },
      {
        name: limbName(sign, 'UpperLeg'),
        type: 'box',
        size: [1, 0.95, 1],
        position: [sign * 0.5, 1.5, 0],
        color: 'pants',
        pivot: [sign * 0.5, 1.95, 0]
      },
      {
        name: limbName(sign, 'LowerLeg'),
        type: 'box',
        size: [1, 0.8, 1],
        position: [sign * 0.5, 0.65, 0],
        color: 'pants',
        pivot: [sign * 0.5, 1.03, 0]
      },
      {
        name: limbName(sign, 'Foot'),
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

/**
 * `R15_HERO` (`engine-DoiMMBHL.js:337-350`).
 *
 * Note: no `skeleton`. The 15 canonical names come from the R15 table, and
 * `checkRig` accepts it because `rig === "R15"` and every canonical name is
 * present — `Head` is a `group`, which still counts as a named top-level part.
 */
export const R15_HERO_EXAMPLE: ModelSpec = {
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

/** `F()` — the quadruped's parts (`engine-DoiMMBHL.js:351-435`). */
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

/**
 * `I` — the 8 leg bones (`engine-DoiMMBHL.js:436-453`).
 *
 * The joint names deliberately reuse the humanoid shoulder/elbow/hip/knee
 * vocabulary on a quadruped.
 */
function dogLegSkeleton(): NonNullable<ModelSpec['skeleton']> {
  const bones: NonNullable<ModelSpec['skeleton']> = []
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

/** `DOG` (`engine-DoiMMBHL.js:454-486`): 3 spine bones plus the 8 leg bones. */
export const DOG_EXAMPLE: ModelSpec = {
  version: 1,
  name: 'Puppy',
  category: 'character',
  rig: 'custom',
  palette: {
    fur: '#c98a4b',
    dark: '#7a4a24',
    muzzle: '#f1d7b8',
    nose: '#1b1b1f'
  },
  skeleton: [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck', axis: [1, 0, 0], limits: [-30, 40] },
    { part: 'Tail', parent: 'Body', joint: 'TailBase', axis: [0, 1, 0], limits: [-45, 45] },
    ...dogLegSkeleton()
  ],
  parts: dogParts()
}
