import type { ModelSpec } from '../schema'
import type { Target } from './stress-score'

const STUD_PER_METRE = 3.5714

const box = (
  size: [number, number, number],
  position: [number, number, number],
  color: string,
  extra: Record<string, unknown> = {}
) => ({ type: 'box', size, position, color, ...extra })

const sphere = (radius: number, position: [number, number, number], color: string) => ({
  type: 'sphere',
  radius,
  position,
  color
})

const cylinder = (
  radius: number,
  height: number,
  position: [number, number, number],
  color: string,
  rotation?: [number, number, number]
) => ({ type: 'cylinder', radius, height, position, color, ...(rotation ? { rotation } : {}) })

const group = (name: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  name,
  type: 'group',
  children,
  ...extra
})

/**
 * A 12 m dragon, built the way a large creature has to be: an S-curved spine of
 * segments, a neck that tapers, a tail that narrows to a point, and organic
 * volume from spheres rather than slabs of box.
 */
function dragon(): ModelSpec {
  const P = (x: number, y: number, z: number): [number, number, number] => [
    x * STUD_PER_METRE,
    y * STUD_PER_METRE,
    z * STUD_PER_METRE
  ]
  const R = (metres: number) => metres * STUD_PER_METRE

  /**
   * Place `count` segments along a curve so each one overlaps the next.
   *
   * The step is a fraction of the two radii, not a fixed distance: that is what
   * keeps a tapering chain closed. A fixed step leaves a gap as soon as the
   * segments get thinner, which is exactly how the shipped dragon came out with
   * floating beads for a neck.
   */
  const walkChain = (
    count: number,
    radiusAt: (index: number) => number,
    curve: (u: number) => [number, number, number]
  ) => {
    const SAMPLES = 600
    const points: [number, number, number][] = []
    for (let index = 0; index <= SAMPLES; index++) points.push(curve(index / SAMPLES))
    const cumulative = [0]
    for (let index = 1; index <= SAMPLES; index++) {
      const [ax, ay, az] = points[index - 1]
      const [bx, by, bz] = points[index]
      cumulative.push(cumulative[index - 1] + Math.hypot(bx - ax, by - ay, bz - az))
    }
    const total = cumulative[SAMPLES]

    const at = (u: number): [number, number, number] => {
      const target = Math.min(total, Math.max(0, u * total))
      let low = 0
      let high = SAMPLES
      while (low < high) {
        const mid = (low + high) >> 1
        if (cumulative[mid] < target) low = mid + 1
        else high = mid
      }
      return points[low]
    }

    const placed: { position: [number, number, number]; radius: number }[] = []
    let travelled = 0
    placed.push({ position: at(0), radius: radiusAt(0) })
    for (let index = 1; index < count; index++) {
      travelled += 0.78 * (radiusAt(index - 1) + radiusAt(index))
      placed.push({ position: at(travelled / total), radius: radiusAt(index) })
    }
    return placed
  }

  const spine = walkChain(
    14,
    (index) => {
      const t = index / 13
      return R(0.8 - Math.abs(t - 0.4) * 0.5)
    },
    (u) => P(Math.sin(u * Math.PI * 1.3) * 0.55, 1.9 + Math.cos(u * Math.PI) * 0.15, -1.5 + u * 3.5)
  ).map(({ position, radius }) => sphere(radius, position, 'scale'))

  const neck = walkChain(
    12,
    (index) => R(0.62 - (index / 11) * 0.26),
    (u) => P(0.5 + Math.sin(u * Math.PI * 0.9) * 0.45, 1.95 + u * 1.6, 1.95 + u * 2.8)
  ).map(({ position, radius }) => sphere(radius, position, 'scale'))

  const tail = walkChain(
    18,
    (index) => R(0.66 - (index / 17) * 0.58),
    (u) => P(Math.sin(u * Math.PI * 1.8) * 0.7, 1.85 - u * 1.0, -1.5 - u * 4.6)
  ).map(({ position, radius }, index) => sphere(radius, position, index > 15 ? 'horn' : 'scale'))

  const head = [
    sphere(R(0.7), P(0.95, 3.55, 4.75), 'scale'),
    box([R(0.62), R(0.5), R(1.1)], P(1.0, 3.4, 5.5), 'scale'),
    box([R(0.45), R(0.22), R(0.9)], P(1.0, 3.1, 5.45), 'belly'),
    box([R(0.14), R(0.75), R(0.14)], P(1.22, 4.05, 4.5), 'horn'),
    box([R(0.14), R(0.75), R(0.14)], P(0.68, 4.05, 4.5), 'horn'),
    box([R(0.1), R(0.1), R(0.5)], P(1.18, 3.75, 5.35), 'horn'),
    box([R(0.1), R(0.1), R(0.5)], P(0.72, 3.75, 5.35), 'horn'),
    sphere(R(0.1), P(1.22, 3.65, 5.15), 'eye'),
    sphere(R(0.1), P(0.68, 3.65, 5.15), 'eye')
  ]

  const leg = (side: 1 | -1, front: boolean) => {
    const z = front ? 1.2 : -0.9
    return [
      sphere(R(0.42), P(side * 0.85, 1.5, z), 'dark'),
      cylinder(R(0.3), R(0.95), P(side * 0.85, 0.95, z), 'dark'),
      sphere(R(0.32), P(side * 0.85, 0.45, z), 'dark'),
      cylinder(R(0.24), R(0.7), P(side * 0.85, 0.25, z + 0.1), 'dark'),
      box([R(0.62), R(0.18), R(0.85)], P(side * 0.85, 0.09, z + 0.3), 'claw'),
      box([R(0.14), R(0.15), R(0.42)], P(side * 0.85 - 0.22, 0.1, z + 0.66), 'claw'),
      box([R(0.14), R(0.15), R(0.42)], P(side * 0.85, 0.1, z + 0.72), 'claw'),
      box([R(0.14), R(0.15), R(0.42)], P(side * 0.85 + 0.22, 0.1, z + 0.66), 'claw')
    ]
  }

  const wing = (side: 1 | -1) => [
    group(
      'Membrane',
      [
        box([R(0.12), R(0.12), R(2.8)], P(0, 0, 0), 'wing'),
        box([R(0.09), R(0.09), R(2.4)], P(0, -0.4, 0.1), 'wing'),
        box([R(0.09), R(0.09), R(1.9)], P(0, -0.75, 0.25), 'wing')
      ],
      { array: { count: 7, step: [R(0.42), 0, R(-0.16)] } }
    ),
    cylinder(R(0.15), R(3.2), P(side * 1.0, 2.75, 0.3), 'dark', [90, 0, 0]),
    cylinder(R(0.13), R(2.2), P(side * 1.9, 3.4, -0.6), 'dark', [0, 0, side * 24]),
    sphere(R(0.26), P(side * 1.0, 2.75, 0.3), 'dark'),
    box([R(0.16), R(0.16), R(0.5)], P(side * 1.6, 3.2, 1.4), 'claw')
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
      group('Spine', spine, { chain: true }),
      group('Neck', neck, { chain: true }),
      group('Head', head),
      group('Tail', tail, { chain: true }),
      group('FrontLegs', [...leg(1, true), ...leg(-1, true)]),
      group('BackLegs', [...leg(1, false), ...leg(-1, false)]),
      group('Wings', [...wing(1), ...wing(-1)])
    ]
  } as unknown as ModelSpec
}

/** A rigged R15 humanoid with a full skeleton and a readable face. */
function hero(): ModelSpec {
  const palette = {
    skin: '#f2c39b',
    shirt: '#3a7bd5',
    pants: '#2c3e50',
    shoe: '#1b1b1f',
    eye: '#1b1b1f',
    hair: '#3b2418'
  }
  const limb = (name: string, y: number, len: number, color: string) => ({
    name,
    type: 'box',
    size: [1, len, 1],
    position: [0, y, 0],
    color,
    pivot: [0, y + len / 2, 0]
  })
  const arm = (side: 1 | -1, upper: boolean) => {
    const x = side * 0.95
    const y = upper ? 3.6 : 2.6
    return {
      ...limb(
        `${side > 0 ? 'Left' : 'Right'}${upper ? 'Upper' : 'Lower'}Arm`,
        y,
        1.2,
        upper ? 'shirt' : 'skin'
      ),
      position: [x, y, 0],
      pivot: [x, y + 0.6, 0]
    }
  }
  const legPart = (side: 1 | -1, upper: boolean) => {
    const x = side * 0.4
    const y = upper ? 1.8 : 0.8
    return {
      ...limb(`${side > 0 ? 'Left' : 'Right'}${upper ? 'Upper' : 'Lower'}Leg`, y, 1.2, 'pants'),
      position: [x, y, 0],
      pivot: [x, y + 0.6, 0]
    }
  }

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
      group(
        'Head',
        [
          box([1.4, 1.4, 1.4], [0, 5.4, 0], 'skin'),
          sphere(0.62, [0, 5.75, 0], 'hair'),
          sphere(0.12, [0.3, 5.5, 0.72], 'eye'),
          sphere(0.12, [-0.3, 5.5, 0.72], 'eye'),
          box([0.16, 0.16, 0.3], [0.3, 5.5, 0.62], 'eye'),
          box([0.16, 0.16, 0.3], [-0.3, 5.5, 0.62], 'eye'),
          box([0.5, 0.1, 0.1], [0, 5.1, 0.72], 'eye')
        ],
        { pivot: [0, 4.8, 0] }
      ),
      arm(1, true),
      arm(1, false),
      { ...limb('LeftHand', 1.85, 0.5, 'skin'), position: [0.95, 1.85, 0], pivot: [0.95, 2.1, 0] },
      arm(-1, true),
      arm(-1, false),
      {
        ...limb('RightHand', 1.85, 0.5, 'skin'),
        position: [-0.95, 1.85, 0],
        pivot: [-0.95, 2.1, 0]
      },
      legPart(1, true),
      legPart(1, false),
      {
        name: 'LeftFoot',
        type: 'box',
        size: [1, 0.4, 1.4],
        position: [0.4, 0.2, 0.2],
        color: 'shoe',
        pivot: [0.4, 0.4, 0]
      },
      legPart(-1, true),
      legPart(-1, false),
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

/**
 * A 1:1 two-room apartment, furnished: 10 m ÃƒÆ’Ã¢â‚¬â€ 8 m at a 3 m ceiling, which is
 * 35.7 ÃƒÆ’Ã¢â‚¬â€ 28.6 ÃƒÆ’Ã¢â‚¬â€ 10.7 studs. The shell is 6 walls with window and door openings
 * framed rather than cut, and every room is furnished, because an empty box is
 * the failure this test exists to catch.
 */
function apartment(): ModelSpec {
  const width = 10 * STUD_PER_METRE
  const depth = 8 * STUD_PER_METRE
  const ceiling = 3 * STUD_PER_METRE
  const wall = 0.4
  const halfW = width / 2
  const halfD = depth / 2

  const chair = (side: 1 | -1): unknown[] => [
    box([1.5, 0.35, 1.5], [0, 1.6, 0], 'wood'),
    box([1.5, 1.9, 0.3], [0, 2.6, -0.6], 'wood'),
    box([0.25, 1.6, 0.25], [side * 0.55, 0.8, 0.55], 'wood'),
    box([0.25, 1.6, 0.25], [-side * 0.55, 0.8, 0.55], 'wood'),
    box([0.25, 1.6, 0.25], [side * 0.55, 0.8, -0.55], 'wood'),
    box([0.25, 1.6, 0.25], [-side * 0.55, 0.8, -0.55], 'wood')
  ]

  return {
    version: 1,
    name: 'Apartment 1:1',
    category: 'building',
    palette: {
      slab: '#b9b3a8',
      wall: '#e8e2d6',
      trim: '#8a8578',
      wood: '#8a5a2b',
      darkWood: '#5c3a1c',
      fabric: '#4a6b8a',
      linen: '#f2efe6',
      glass: '#7fb3d5',
      steel: '#9aa0a6',
      dark: '#2b2b2f',
      plant: '#3f6b3a',
      lamp: '#ffe9b0'
    },
    parts: [
      group('Floor', [box([width, wall, depth], [0, 0, 0], 'slab')]),
      group('Ceiling', [box([width, wall, depth], [0, ceiling, 0], 'wall')]),
      group('OuterWalls', [
        box([width, ceiling, wall], [0, ceiling / 2, -halfD], 'wall'),
        box([width, ceiling, wall], [0, ceiling / 2, halfD], 'wall'),
        box([wall, ceiling, depth], [-halfW, ceiling / 2, 0], 'wall'),
        box([wall, ceiling, depth], [halfW, ceiling / 2, 0], 'wall')
      ]),
      group('Partition', [
        box([wall, ceiling, depth * 0.45], [1.5, ceiling / 2, -depth * 0.28], 'wall'),
        box([wall, ceiling * 0.55, depth * 0.18], [1.5, ceiling * 0.72, -depth * 0.06], 'wall')
      ]),
      group(
        'Windows',
        [
          box([4.2, 4.6, 0.25], [0, 0, 0], 'glass'),
          box([4.6, 0.3, 0.45], [0, 2.4, 0.05], 'trim'),
          box([4.6, 0.3, 0.45], [0, -2.4, 0.05], 'trim'),
          box([0.3, 4.6, 0.45], [2.1, 0, 0.05], 'trim'),
          box([0.3, 4.6, 0.45], [-2.1, 0, 0.05], 'trim'),
          box([0.2, 4.2, 0.3], [0, 0, 0.1], 'trim')
        ],
        { array: { count: 3, step: [5.6, 0, 0] }, position: [-5.6, 6.2, -halfD + 0.3] }
      ),
      group(
        'KitchenRun',
        [
          box([10, 0.4, 4.2], [0, 0, 0], 'slab'),
          box([10, 2.6, 0.3], [0, 1.5, -1.95], 'wood'),
          box([10, 0.4, 4.2], [0, 3, 0], 'steel'),
          box([2.6, 0.3, 2.6], [2.4, 3.1, 0], 'steel'),
          box([2.2, 0.15, 2.2], [2.4, 3.25, 0], 'dark')
        ],
        { position: [0, 0, -halfD + 2.6] }
      ),
      group(
        'Cabinets',
        [
          box([2.2, 2.4, 2.0], [0, 0, 0], 'wood'),
          box([2.0, 0.2, 0.15], [0, 1.0, 1.0], 'trim'),
          box([2.0, 0.2, 0.15], [0, -0.4, 1.0], 'trim')
        ],
        { array: { count: 4, step: [2.5, 0, 0] }, position: [-3.9, 6.4, -halfD + 1.5] }
      ),
      group(
        'Fridge',
        [
          box([2.6, 5.4, 2.4], [0, 0, 0], 'steel'),
          box([2.4, 0.12, 0.2], [0, 1.2, 1.25], 'dark'),
          box([0.12, 1.6, 0.25], [1.05, 2.6, 1.3], 'dark')
        ],
        { position: [halfW - 2.2, 2.9, -halfD + 1.8] }
      ),
      group(
        'DiningTable',
        [
          box([5.6, 0.35, 3.2], [0, 2.7, 0], 'wood'),
          box([0.4, 2.7, 0.4], [2.3, 1.35, 1.2], 'darkWood'),
          box([0.4, 2.7, 0.4], [-2.3, 1.35, 1.2], 'darkWood'),
          box([0.4, 2.7, 0.4], [2.3, 1.35, -1.2], 'darkWood'),
          box([0.4, 2.7, 0.4], [-2.3, 1.35, -1.2], 'darkWood')
        ],
        { position: [2.5, 0, 2.2] }
      ),
      group('Chairs', chair(1), { position: [-0.9, 0, 0] }),
      group('ChairsMirror', chair(-1), { position: [0.9, 0, 0] }),
      group(
        'Sofa',
        [
          box([9.5, 1.1, 4.0], [0, 0.9, 0], 'fabric'),
          box([9.5, 2.6, 0.7], [0, 2.4, -1.65], 'fabric'),
          box([0.8, 1.8, 4.0], [4.35, 1.5, 0], 'fabric'),
          box([0.8, 1.8, 4.0], [-4.35, 1.5, 0], 'fabric'),
          group('Cushions', [box([2.6, 0.5, 2.6], [0, 0, 0], 'linen')], {
            array: { count: 3, step: [3.0, 0, 0] },
            position: [-3.0, 1.7, 0.3]
          })
        ],
        { position: [-6.0, 0, 3.0] }
      ),
      group(
        'CoffeeTable',
        [
          box([4.4, 0.3, 2.4], [0, 1.5, 0], 'darkWood'),
          box([0.3, 1.5, 0.3], [1.9, 0.75, 1.0], 'dark'),
          box([0.3, 1.5, 0.3], [-1.9, 0.75, 1.0], 'dark'),
          box([0.3, 1.5, 0.3], [1.9, 0.75, -1.0], 'dark'),
          box([0.3, 1.5, 0.3], [-1.9, 0.75, -1.0], 'dark'),
          box([1.2, 0.4, 0.9], [0.6, 1.85, 0.2], 'linen')
        ],
        { position: [-6.0, 0, 0.2] }
      ),
      group('Rug', [box([9.0, 0.12, 6.0], [0, 0, 0], 'fabric')], { position: [-6.0, 0.55, 1.6] }),
      group(
        'Shelves',
        [
          box([6.0, 0.25, 1.6], [0, 0, 0], 'wood'),
          group('Books', [box([0.35, 1.4, 1.1], [0, 0.8, 0], 'fabric')], {
            array: { count: 6, step: [0.42, 0, 0] },
            position: [-2.4, 0.1, 0]
          })
        ],
        { array: { count: 4, step: [0, 1.9, 0] }, position: [halfW - 1.2, 1.0, 2.4] }
      ),
      group(
        'BedFrame',
        [
          box([6.6, 1.0, 8.6], [0, 0.9, 0], 'darkWood'),
          box([6.6, 3.2, 0.5], [0, 2.0, -4.2], 'darkWood')
        ],
        { position: [-6.2, 0, -5.4] }
      ),
      group(
        'Mattress',
        [box([6.2, 1.4, 8.0], [0, 0, 0], 'linen'), box([6.4, 0.5, 5.0], [0, 0.8, 1.4], 'fabric')],
        { position: [-6.2, 1.9, -5.4] }
      ),
      group('Pillows', [box([2.4, 0.9, 1.5], [0, 0, 0], 'linen')], {
        mirror: 'x',
        position: [-6.2, 2.9, -8.2]
      }),
      group(
        'Nightstand',
        [
          box([2.0, 2.2, 2.0], [0, 0, 0], 'wood'),
          box([1.6, 0.2, 0.2], [0, 0.4, 1.0], 'trim'),
          cylinder(0.6, 1.4, [0, 1.8, 0], 'steel'),
          sphere(0.9, [0, 2.6, 0], 'lamp')
        ],
        { mirror: 'x', position: [-9.4, 1.1, -8.4] }
      ),
      group(
        'Wardrobe',
        [
          box([7.0, 8.0, 2.6], [0, 0, 0], 'wood'),
          box([0.15, 7.6, 0.15], [0, 0, 1.35], 'trim'),
          box([0.2, 0.5, 0.2], [0.5, 0, 1.45], 'steel'),
          box([0.2, 0.5, 0.2], [-0.5, 0, 1.45], 'steel')
        ],
        { position: [1.5, 4.0, -halfD + 1.6] }
      ),
      group(
        'Bathroom',
        [
          box([3.0, 1.6, 2.2], [0, 0, 0], 'linen'),
          box([3.0, 2.6, 0.5], [0, 1.9, -1.0], 'linen'),
          box([2.4, 0.5, 1.8], [0, 0.9, 0], 'steel'),
          cylinder(0.35, 3.0, [0, 3.0, -1.0], 'steel')
        ],
        { position: [halfW - 4.0, 0, -halfD + 3.0] }
      ),
      group(
        'Shower',
        [
          box([4.0, 0.3, 4.0], [0, 0.15, 0], 'slab'),
          box([4.0, 6.0, 0.2], [0, 3.0, -2.0], 'glass'),
          box([0.2, 6.0, 4.0], [2.0, 3.0, 0], 'glass')
        ],
        { position: [halfW - 3.0, 0, -halfD + 7.0] }
      ),
      group(
        'Plants',
        [
          cylinder(0.8, 1.4, [0, 0.7, 0], 'darkWood'),
          sphere(1.6, [0, 3.0, 0], 'plant'),
          sphere(1.1, [0.7, 4.2, 0.4], 'plant'),
          sphere(0.9, [-0.6, 3.8, -0.5], 'plant')
        ],
        { position: [-halfW + 2.0, 0, halfD - 2.0] }
      ),
      group(
        'CeilingLights',
        [cylinder(0.15, 1.2, [0, -0.6, 0], 'steel'), sphere(1.2, [0, -1.5, 0], 'lamp')],
        { array: { count: 4, step: [8.0, 0, 0] }, position: [-12.0, ceiling - 0.4, 0] }
      ),
      group(
        'Doors',
        [
          box([4.2, 7.2, 0.3], [0, 3.6, 0], 'wood'),
          box([4.6, 0.4, 0.45], [0, 7.4, 0.05], 'trim'),
          box([0.4, 7.2, 0.45], [2.1, 3.6, 0.05], 'trim'),
          box([0.4, 7.2, 0.45], [-2.1, 3.6, 0.05], 'trim'),
          sphere(0.25, [1.6, 3.6, 0.3], 'steel')
        ],
        { position: [1.5, 0, -depth * 0.06] }
      )
    ]
  } as unknown as ModelSpec
}

/** A pickaxe: a swept handle, a boolean head, and polygon blades. */
function pickaxe(): ModelSpec {
  return {
    version: 1,
    name: 'Miner Pickaxe',
    category: 'tool',
    palette: { wood: '#8a5a2b', iron: '#6f7276', edge: '#cfd4d8', grip: '#2b2b2b' },
    parts: [
      {
        name: 'Handle',
        type: 'tube',
        path: [
          [0, 0, 0],
          [0, 3, 0.15],
          [0, 6, 0]
        ],
        radius: 0.35,
        color: 'wood'
      },
      group('Grip', [
        {
          type: 'tube',
          path: [
            [0, 0.4, 0],
            [0, 1.6, 0.05]
          ],
          radius: 0.42,
          color: 'grip'
        },
        {
          type: 'tube',
          path: [
            [0, 1.9, 0.05],
            [0, 3.1, 0.12]
          ],
          radius: 0.42,
          color: 'grip'
        },
        {
          type: 'tube',
          path: [
            [0, 3.4, 0.12],
            [0, 4.6, 0.06]
          ],
          radius: 0.42,
          color: 'grip'
        }
      ]),
      group('Head', [
        box([7, 1.1, 1.1], [0, 6.2, 0], 'iron'),
        box([1.4, 1.8, 1.4], [0, 6.2, 0], 'iron'),
        {
          type: 'extrude',
          shape: {
            type: 'polygon',
            points: [
              [0, 0],
              [1.6, 0.5],
              [2.0, 1.5],
              [0.6, 1.4]
            ]
          },
          depth: 0.5,
          position: [3.4, 5.6, 0],
          color: 'edge'
        },
        {
          type: 'extrude',
          shape: {
            type: 'polygon',
            points: [
              [0, 0],
              [-1.6, 0.5],
              [-2.0, 1.5],
              [-0.6, 1.4]
            ]
          },
          depth: 0.5,
          position: [-3.4, 5.6, 0],
          color: 'edge'
        }
      ]),
      group('Binding', [box([1.5, 0.35, 1.5], [0, 0, 0], 'grip')], {
        array: { count: 4, step: [0, 0.55, 0] },
        position: [0, 5.4, 0]
      })
    ]
  } as unknown as ModelSpec
}

/** A back accessory at its UGC bound, with layered plates and a mirrored strap. */
function backpack(): ModelSpec {
  return {
    version: 1,
    name: 'Expedition Pack',
    category: 'accessory',
    accessoryType: 'Back',
    palette: { canvas: '#4a5a3a', strap: '#2b2b2b', buckle: '#c9a227', rope: '#c9b48a' },
    parts: [
      group('Pack', [
        box([8, 6.5, 3.0], [0, 4, -1.3], 'canvas'),
        box([7, 1.4, 3.2], [0, 5.6, -1.3], 'canvas'),
        box([1.2, 6.5, 0.4], [0, 4, 0.4], 'strap'),
        box([0.9, 0.9, 0.5], [0, 4.4, 0.6], 'buckle'),
        box([0.9, 0.9, 0.5], [0, 3.4, 0.6], 'buckle'),
        box([7.6, 0.4, 0.5], [0, 6.9, -1.3], 'strap')
      ]),
      group('Straps', [box([0.7, 5.5, 0.35], [3.4, 0, 0], 'strap')], {
        mirror: 'x',
        position: [0, 4, 0.5]
      }),
      group(
        'Pockets',
        [
          box([2.2, 2.0, 0.9], [0, 0, 0], 'canvas'),
          box([2.4, 0.35, 1.0], [0, 1.1, 0], 'strap'),
          box([0.5, 0.5, 0.3], [0, 0.5, 0.55], 'buckle')
        ],
        { array: { count: 3, step: [2.6, 0, -0.15] }, position: [-2.6, 3.2, -2.7] }
      ),
      group('Coil', [cylinder(0.35, 1.1, [0, 0, 0], 'rope')], {
        array: { count: 5, radial: true },
        position: [0, 6.4, -1.3]
      })
    ]
  } as unknown as ModelSpec
}

/** A sign: text, a frame, and a stand. */
function sign(): ModelSpec {
  return {
    version: 1,
    name: 'Workshop Sign',
    category: 'text',
    palette: { board: '#3b2f2a', letter: '#f0e6d2', frame: '#8a6a3a', post: '#6b4f2a' },
    parts: [
      group('Board', [
        box([16, 6, 0.8], [0, 5, 0], 'board'),
        box([16.6, 0.6, 1.2], [0, 8.2, 0], 'frame'),
        box([16.6, 0.6, 1.2], [0, 1.8, 0], 'frame'),
        box([0.6, 6.6, 1.2], [8.2, 5, 0], 'frame'),
        box([0.6, 6.6, 1.2], [-8.2, 5, 0], 'frame'),
        {
          type: 'text',
          text: 'WORKSHOP',
          size: 2.2,
          depth: 0.4,
          position: [0, 5, 0.6],
          color: 'letter'
        }
      ]),
      group('Posts', [box([0.9, 5, 0.9], [0, 0, 0], 'post')], {
        array: { count: 2, step: [6.4, 0, 0] },
        position: [0, -1.5, 0]
      }),
      group('Bolts', [cylinder(0.22, 0.3, [0, 0, 0], 'frame', [90, 0, 0])], {
        array: { count: 4, step: [4, 0, 0] },
        position: [-6, 7.6, 0.5]
      })
    ]
  } as unknown as ModelSpec
}

export interface Case {
  name: string
  category: string
  spec: ModelSpec
  target: Target
  accessoryType?: string
}

export const CASES: Case[] = [
  {
    name: 'dragon',
    category: 'prop',
    spec: dragon(),
    target: { parts: 120, triangles: 18000, size: [17, 17, 42] }
  },
  {
    name: 'hero',
    category: 'character',
    spec: hero(),
    target: { parts: 20, triangles: 1200, size: [2.5, 6, 1.4] }
  },
  {
    name: 'apartment',
    category: 'building',
    spec: apartment(),
    target: { parts: 140, triangles: 5000, size: [36, 11, 28] }
  },
  {
    name: 'pickaxe',
    category: 'tool',
    spec: pickaxe(),
    target: { parts: 12, triangles: 1500, size: [7, 6, 1.3] }
  },
  {
    name: 'backpack',
    category: 'accessory',
    spec: backpack(),
    accessoryType: 'Back',
    target: { parts: 17, triangles: 500, size: [7.5, 6, 4] }
  },
  {
    name: 'sign',
    category: 'text',
    spec: sign(),
    target: { parts: 12, triangles: 2500, size: [17, 11, 1.3] }
  }
]
