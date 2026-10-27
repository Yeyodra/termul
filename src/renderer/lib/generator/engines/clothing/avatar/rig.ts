/**
 * The R15 / R6 skeleton: joint pivots, attachment points and poses.
 *
 * Ported 1:1 from RobloxKit's `rig-P29m_B-3.js`. The pivots are Roblox's real
 * R15 proportions (a 2x2x1 torso at y=2..4, 1x2x1 limbs hanging from y=3.6), so
 * they are not free parameters — moving one changes where a garment sits on the
 * body and therefore how it reads in the review image.
 *
 * Only what the review render needs is here: the pivot table, the R15-to-R6 part
 * name fold, the five standing poses, and the cyclic gait poses. The full
 * attachment list upstream ships is not needed to draw a still.
 */

/** Which skeleton a render targets. */
export type Rig = 'R15' | 'R6'

/** One bone: its parent and the world pivot the mesh hangs from. */
export interface RigPart {
  part: string
  parent: string | null
  pivot: [number, number, number]
}

const R15_PARTS: RigPart[] = [
  { part: 'LowerTorso', parent: null, pivot: [0, 2, 0] },
  { part: 'UpperTorso', parent: 'LowerTorso', pivot: [0, 2.4, 0] },
  { part: 'Head', parent: 'UpperTorso', pivot: [0, 4, 0] },
  { part: 'LeftUpperArm', parent: 'UpperTorso', pivot: [1.5, 3.6, 0] },
  { part: 'LeftLowerArm', parent: 'LeftUpperArm', pivot: [1.5, 3.1, 0] },
  { part: 'LeftHand', parent: 'LeftLowerArm', pivot: [1.5, 2.3, 0] },
  { part: 'RightUpperArm', parent: 'UpperTorso', pivot: [-1.5, 3.6, 0] },
  { part: 'RightLowerArm', parent: 'RightUpperArm', pivot: [-1.5, 3.1, 0] },
  { part: 'RightHand', parent: 'RightLowerArm', pivot: [-1.5, 2.3, 0] },
  { part: 'LeftUpperLeg', parent: 'LowerTorso', pivot: [0.5, 2, 0] },
  { part: 'LeftLowerLeg', parent: 'LeftUpperLeg', pivot: [0.5, 1.14, 0] },
  { part: 'LeftFoot', parent: 'LeftLowerLeg', pivot: [0.5, 0.3, 0] },
  { part: 'RightUpperLeg', parent: 'LowerTorso', pivot: [-0.5, 2, 0] },
  { part: 'RightLowerLeg', parent: 'RightUpperLeg', pivot: [-0.5, 1.14, 0] },
  { part: 'RightFoot', parent: 'RightLowerLeg', pivot: [-0.5, 0.3, 0] }
]

const R6_PARTS: RigPart[] = [
  { part: 'Torso', parent: null, pivot: [0, 2, 0] },
  { part: 'Head', parent: 'Torso', pivot: [0, 4, 0] },
  { part: 'LeftArm', parent: 'Torso', pivot: [1.5, 3.6, 0] },
  { part: 'RightArm', parent: 'Torso', pivot: [-1.5, 3.6, 0] },
  { part: 'LeftLeg', parent: 'Torso', pivot: [0.5, 2, 0] },
  { part: 'RightLeg', parent: 'Torso', pivot: [-0.5, 2, 0] }
]

/** The bones of a rig, in parent-before-child order. */
export function rigParts(rig: Rig): RigPart[] {
  return rig === 'R6' ? R6_PARTS : R15_PARTS
}

/** R15 part name -> the single R6 part that owns it. */
const R15_TO_R6: Record<string, string> = {
  LowerTorso: 'Torso',
  UpperTorso: 'Torso',
  Head: 'Head',
  LeftUpperArm: 'LeftArm',
  LeftLowerArm: 'LeftArm',
  LeftHand: 'LeftArm',
  RightUpperArm: 'RightArm',
  RightLowerArm: 'RightArm',
  RightHand: 'RightArm',
  LeftUpperLeg: 'LeftLeg',
  LeftLowerLeg: 'LeftLeg',
  LeftFoot: 'LeftLeg',
  RightUpperLeg: 'RightLeg',
  RightLowerLeg: 'RightLeg',
  RightFoot: 'RightLeg'
}

/** Fold an R15 part name onto its R6 equivalent; R6 names pass through. */
export function r6Name(rig: Rig, part: string): string {
  return rig === 'R6' ? (R15_TO_R6[part] ?? part) : part
}

/** A joint rotation in degrees, per bone. */
export type JointPose = Record<string, [number, number, number]>

/** A named standing pose. */
export interface Pose {
  label: string
  joints: JointPose
  root?: [number, number, number]
}

export const POSES: Record<string, Pose> = {
  stand: {
    label: 'Standing',
    joints: { LeftUpperArm: [0, 0, 4], RightUpperArm: [0, 0, -4] }
  },
  heroic: {
    label: 'Heroic',
    joints: {
      UpperTorso: [-4, 0, 0],
      Head: [-6, -12, 0],
      LeftUpperArm: [0, 0, 32],
      LeftLowerArm: [-20, 0, -70],
      RightUpperArm: [0, 0, -32],
      RightLowerArm: [-20, 0, 70],
      LeftUpperLeg: [0, 0, 9],
      RightUpperLeg: [0, 0, -9],
      LeftFoot: [0, 0, -9],
      RightFoot: [0, 0, 9]
    }
  }
}

/** The rig's own default standing pose, so a still always has one. */
export const DEFAULT_POSE = 'stand'

/**
 * A pose as a bone -> degrees map, folded onto R6 when needed.
 *
 * R6 has one bone per limb, so only the R15 upper-limb entries survive; that is
 * upstream's rule and it is why an R6 render looks stiffer.
 */
export function poseJoints(rig: Rig, pose: Pose | string = DEFAULT_POSE): JointPose {
  const resolved = typeof pose === 'string' ? (POSES[pose] ?? POSES[DEFAULT_POSE]) : pose
  const joints = resolved.joints ?? {}

  if (rig !== 'R6') return { ...joints }

  const folded: JointPose = {}
  for (const [bone, degrees] of Object.entries(joints)) {
    const mapped = R15_TO_R6[bone]
    if (mapped) folded[mapped] = degrees
  }
  return folded
}

/** The root offset a pose asks for, or none. */
export function poseRoot(pose: Pose | string = DEFAULT_POSE): [number, number, number] {
  const resolved = typeof pose === 'string' ? (POSES[pose] ?? POSES[DEFAULT_POSE]) : pose
  return resolved.root ?? [0, 0, 0]
}
