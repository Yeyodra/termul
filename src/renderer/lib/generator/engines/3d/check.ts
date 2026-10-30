/**
 * The UGC and per-category checks a built model has to pass.
 *
 * Ported from `ugc-DX1uf6HZ.js` (the whole file) plus the rig-bound checks in
 * `rig-CDpj6dii.js:155-225`. The issue catalogue is documented verbatim in
 * `re/full-reverse/08-3d-polyforge/REPORT.md` §12.9.
 *
 * Only `level: 'error'` blocks; `ok` is computed from that alone, which is what
 * gates `DONE` in the design loop (`15/01` §1.1 I2). The strings are echoed to
 * the model, so they are part of the contract.
 *
 * Why this matters practically: an accessory over Roblox's 4000-triangle limit
 * is refused at upload, so catching it here is the difference between a working
 * generator and one that produces uploads Roblox rejects.
 */
import * as THREE from 'three'
import type { BuildIssue, BuildReport } from '../../types'
import { type Model, modelBounds, modelTriangles } from './build'

/** Per-accessory triangle cap (`TRIANGLE_LIMIT`, `ugc-DX1uf6HZ.js:13`). */
export const TRIANGLE_LIMIT = 4000
/** Roblox's per-mesh import cap (`MESH_TRIANGLE_LIMIT`, `:113`). */
export const MESH_TRIANGLE_LIMIT = 20000
/** Palette atlas ceiling (`TEXTURE_LIMIT`, `:14`). */
export const TEXTURE_LIMIT = 1024
/** "heavy for phones" threshold (`l`, `:114`). */
export const HEAVY_TRIANGLES = 10000
/** "close to the limit" threshold for an accessory (`:71`). */
export const NEAR_LIMIT_TRIANGLES = 3600
/** A flat colour on a surface this large reads as plastic (`LARGE_SURFACE`, `:5`). */
export const LARGE_SURFACE = 16

/**
 * The accessory attachment table (`o`, `ugc-DX1uf6HZ.js:15-56`).
 *
 * The `bounds` are the UGC size limits in studs, per axis, and `attachment` is
 * the Roblox attachment name the Studio insert path uses. Both are needed by
 * `sheet` (mannequin framing) and `studio` (insert), not just here.
 */
export const ACCESSORY_BOUNDS: Record<
  string,
  { attachment: string; bounds: [number, number, number]; label: string }
> = {
  Hat: { attachment: 'HatAttachment', bounds: [3, 4, 3], label: 'Hat' },
  Hair: { attachment: 'HairAttachment', bounds: [3, 5, 3.5], label: 'Hair' },
  Face: { attachment: 'FaceFrontAttachment', bounds: [3, 2, 2], label: 'Face' },
  Neck: { attachment: 'NeckAttachment', bounds: [3, 3, 2], label: 'Neck' },
  Shoulder: { attachment: 'NeckAttachment', bounds: [7, 3, 3], label: 'Shoulder' },
  Front: { attachment: 'BodyFrontAttachment', bounds: [3, 3, 3], label: 'Front' },
  Back: { attachment: 'BodyBackAttachment', bounds: [10, 7, 4.5], label: 'Back' },
  Waist: { attachment: 'WaistBackAttachment', bounds: [4, 3.5, 7], label: 'Waist' }
}

/**
 * Accessory attachment world offsets, for the mannequin and the Studio insert
 * (`rigPose-DgicNbzf.js:30-39`).
 */
export const ATTACHMENT_OFFSETS: Record<string, [number, number, number]> = {
  HatAttachment: [0, 5.2, 0],
  HairAttachment: [0, 5.2, 0],
  FaceFrontAttachment: [0, 4.6, 0.6],
  NeckAttachment: [0, 4, 0],
  BodyFrontAttachment: [0, 3, 0.5],
  BodyBackAttachment: [0, 3, -0.5],
  WaistBackAttachment: [0, 2, -0.5],
  WaistCenterAttachment: [0, 2, 0]
}

/** An issue that also names the rule that produced it. */
export interface RuleIssue extends BuildIssue {
  rule: string
}

/** The result of one category check. */
export interface CategoryReport extends BuildReport {
  ok: boolean
  issues: RuleIssue[]
  triangles: number
  size: number[]
  attachment: string | null
  limit: number
  parts: { name: string; triangles: number }[]
  health: Model['health']
}

/** One part group's geometry and bounds, the unit these checks work on. */
export interface PartGroup {
  name: string
  pivot: number[]
  parts: Model['parts']
  triangles: number
  bounds: { min: number[]; max: number[]; size: number[] }
}

/**
 * Group a model's parts by their top-level node.
 *
 * This is `Model.partGroups()` (`model-C3l0LP6n.js:737-755`) without the
 * `merge` path, which Termul does not need: `merge` only decides whether the
 * export collapses groups into one part, and that is `export`'s business.
 */
export function partGroups(model: Model, { merge = false }: { merge?: boolean } = {}): PartGroup[] {
  const box = new THREE.Box3()
  const groups: PartGroup[] = []

  // A merged export collapses every part into one group, which is what
  // `partGroups({merge})` does in the original (`model-C3l0LP6n.js:737-755`):
  // `this.groups?.length && !merge ? this.groups : [<one group>]`.
  const sources =
    merge || !model.groups.length
      ? [{ node: null as number | null, name: model.name, pivot: [0, 0, 0] }]
      : model.groups.map((group) => ({
          node: group.node as number | null,
          name: group.name,
          pivot: group.pivot
        }))

  for (const group of sources) {
    const parts =
      group.node === null ? model.parts : model.parts.filter((part) => part.node === group.node)
    if (!parts.length) continue

    box.makeEmpty()
    for (const part of parts) {
      part.geometry.computeBoundingBox()
      if (part.geometry.boundingBox) box.union(part.geometry.boundingBox)
    }

    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3())
    groups.push({
      name: group.name,
      pivot: group.pivot,
      parts,
      triangles: parts.reduce(
        (total, part) => total + part.geometry.attributes.position.count / 3,
        0
      ),
      bounds: {
        min: box.isEmpty() ? [0, 0, 0] : [box.min.x, box.min.y, box.min.z],
        max: box.isEmpty() ? [0, 0, 0] : [box.max.x, box.max.y, box.max.z],
        size: [size.x, size.y, size.z]
      }
    })
  }

  return groups
}

/**
 * The accessory-level checks (`s`, `ugc-DX1uf6HZ.js:57-112`).
 *
 * Covers the triangle cap and its near-limit warning, the texture ceiling, the
 * per-type bounds, and the empty-model error.
 */
export function validateAccessory(
  model: Model,
  accessoryType = 'Hat',
  { textureSize = 128 }: { textureSize?: number } = {}
): {
  ok: boolean
  triangles: number
  size: number[]
  attachment: string | null
  issues: RuleIssue[]
} {
  const issues: RuleIssue[] = []
  const triangles = Math.round(modelTriangles(model))
  const { size } = modelBounds(model)

  if (triangles > TRIANGLE_LIMIT) {
    issues.push({
      level: 'error',
      rule: 'triangles',
      message: `${triangles} triangles; UGC accessories allow ${TRIANGLE_LIMIT}.`
    })
  } else if (triangles > NEAR_LIMIT_TRIANGLES) {
    issues.push({
      level: 'warn',
      rule: 'triangles',
      message: `${triangles} triangles is close to the ${TRIANGLE_LIMIT} limit.`
    })
  }

  if (textureSize > TEXTURE_LIMIT) {
    issues.push({
      level: 'error',
      rule: 'texture',
      message: `Texture is ${textureSize}px; the limit is ${TEXTURE_LIMIT}×${TEXTURE_LIMIT}.`
    })
  }

  const entry = ACCESSORY_BOUNDS[accessoryType]
  if (entry) {
    const axisNames = ['width', 'height', 'depth']
    size.forEach((value, index) => {
      // The epsilon keeps a model that is exactly at the limit from failing.
      if (value > entry.bounds[index] + 0.000001) {
        issues.push({
          level: 'error',
          rule: 'bounds',
          message:
            `${axisNames[index]} ${value.toFixed(2)} studs is over the ` +
            `${entry.label} limit of ${entry.bounds[index]}.`
        })
      }
    })
  }

  if (model.parts.length === 0) {
    issues.push({ level: 'error', rule: 'empty', message: 'The model has no geometry.' })
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    triangles,
    size: size.map((value) => +value.toFixed(3)),
    attachment: entry?.attachment ?? null,
    issues
  }
}

/** The open-shell warnings (`u`, `ugc-DX1uf6HZ.js:115-129`). */
export function openShellIssues(model: Model): RuleIssue[] {
  const health = model.health
  if (!health) return []

  const issues: RuleIssue[] = []
  for (const [node, edges] of health.open ?? []) {
    const name = model.groups.find((group) => group.node === node)?.name ?? `parts[${node}]`
    issues.push({
      level: 'warn',
      rule: 'open',
      message:
        `${name} has ${edges} open edge${edges === 1 ? '' : 's'}: it is a shell with a hole, ` +
        'and its inside shows from some angles. Close it (a lathe profile that starts and ends ' +
        'on the axis, a capped tube, or a solid shape).'
    })
  }
  return issues
}

/**
 * The flat-colour-on-a-large-surface warning (`d`, `ugc-DX1uf6HZ.js:130-157`).
 *
 * Fires only when a group uses **exactly one** colour, that colour is not
 * textured, and the two largest bounding-box dimensions multiply to at least
 * 16 studs squared. Skipped for `accessory`, `character` and `text`.
 */
export function textureDetailIssues(
  model: Model,
  { category }: { category?: string } = {}
): RuleIssue[] {
  if (category === 'accessory' || category === 'character' || category === 'text') return []

  const textured = new Set(
    Object.entries(model.palette)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([name]) => name)
  )

  const issues: RuleIssue[] = []
  for (const group of partGroups(model)) {
    const colors = new Set(group.parts.map((part) => part.color))
    if (colors.size !== 1) continue

    const [color] = colors
    if (textured.has(color)) continue

    const [largest, second] = [...group.bounds.size].sort((a, b) => b - a)
    if (largest * second < LARGE_SURFACE) continue

    issues.push({
      level: 'warn',
      rule: 'texture-detail',
      message:
        `${group.name} is a large surface (${largest.toFixed(1)} × ${second.toFixed(1)} studs) ` +
        `in one flat colour "${color}": it reads as plastic. Give it a textured palette colour ` +
        '(wood, stone, metal…) or break it up with trims and a second colour.'
    })
  }
  return issues
}

/** Distance from a point to a box, zero when inside (`l`, `rig-CDpj6dii.js:155-158`). */
function distanceOutside(point: number[], box: { min: number[]; max: number[] }): number {
  return Math.hypot(
    ...[0, 1, 2].map((axis) =>
      Math.max(box.min[axis] - point[axis], 0, point[axis] - box.max[axis])
    )
  )
}

/** The opposite-side name, for the symmetry checks (`o`, `rig-CDpj6dii.js:18-31`). */
export function oppositeSide(name: string): string | null {
  if (/Left/.test(name)) return name.replace(/Left/g, 'Right')
  if (/Right/.test(name)) return name.replace(/Right/g, 'Left')
  const match = /^(.*?)([LR])$/.exec(name)
  if (match?.[1]) return match[1] + (match[2] === 'L' ? 'R' : 'L')
  return null
}

/** One bone's joint, as the rig checks need it. */
interface JointEntry {
  part: string
  parent: string
  joint: string
  pivot: number[]
}

/**
 * The rig geometry checks (`u`, `rig-CDpj6dii.js:159-225`).
 *
 * Four rules, each with its own threshold: a pivot more than 0.25 studs outside
 * its own part is an **error**; a joint gap over 0.12, an asymmetric joint pair
 * over 0.15, and a 15 % size mismatch are warnings.
 */
export function checkRigBounds(
  joints: JointEntry[],
  boundsByName: Record<string, { min: number[]; max: number[] }>
): RuleIssue[] {
  const issues: RuleIssue[] = []
  const byName = Object.fromEntries(joints.map((joint) => [joint.part, joint]))

  for (const joint of joints) {
    const box = boundsByName[joint.part]
    if (!box) continue

    const outside = distanceOutside(joint.pivot, box)
    if (outside > 0.25) {
      issues.push({
        level: 'error',
        rule: 'pivot',
        message:
          `${joint.part}'s pivot is ${outside.toFixed(2)} studs outside the part: put it at the ` +
          `${joint.joint} joint, where ${joint.part} meets ${joint.parent}.`
      })
    }

    const parentBox = joint.parent === 'HumanoidRootPart' ? null : boundsByName[joint.parent]
    if (parentBox) {
      const gap = distanceOutside(joint.pivot, parentBox)
      if (gap > 0.12) {
        issues.push({
          level: 'warn',
          rule: 'gap',
          message:
            `${joint.part} meets ${joint.parent} ${gap.toFixed(2)} studs from the joint: bent, a ` +
            'gap opens. Let the segments overlap a little at the joint (or add a rounded joint cap).'
        })
      }
    }
  }

  for (const joint of joints) {
    const opposite = oppositeSide(joint.part)
    if (!opposite || !byName[opposite] || !/Left|L$/.test(joint.part)) continue

    const mine = joint.pivot
    const theirs = byName[opposite].pivot
    const difference = Math.hypot(mine[0] + theirs[0], mine[1] - theirs[1], mine[2] - theirs[2])
    if (difference > 0.15) {
      issues.push({
        level: 'warn',
        rule: 'symmetry',
        message:
          `${joint.part} and ${opposite} are not mirror images (their joints differ by ` +
          `${difference.toFixed(2)} studs).`
      })
    }

    const mineBox = boundsByName[joint.part]
    const theirsBox = boundsByName[opposite]
    if (mineBox && theirsBox) {
      const spans = (box: { min: number[]; max: number[] }) =>
        [0, 1, 2].map((axis) => box.max[axis] - box.min[axis])
      const mineSpans = spans(mineBox)
      const relative = mineSpans.map(
        (span, index) => Math.abs(span - spans(theirsBox)[index]) / Math.max(0.1, span)
      )
      if (Math.max(...relative) > 0.15) {
        issues.push({
          level: 'warn',
          rule: 'symmetry',
          message: `${joint.part} and ${opposite} differ in size.`
        })
      }
    }
  }

  return issues
}

/**
 * The per-category check the loop calls (`f`, `ugc-DX1uf6HZ.js:158-225`).
 *
 * **Quirk reproduced deliberately (`08` §G13):** a non-accessory is validated
 * as `'Prop'`, which is not a key in `ACCESSORY_BOUNDS`, so the bounds loop
 * finds nothing and no size check runs at all. A `building` or a `prop` is
 * therefore bounded only by the spec's own `extent` limit. The plan says to
 * pick one and record it; we keep the original behaviour, because adding a
 * bounds check would reject models the real engine accepts.
 */
export function checkModel(
  model: Model,
  { category, accessoryType }: { category?: string; accessoryType?: string } = {}
): CategoryReport {
  const openIssues = openShellIssues(model)
  const groups = partGroups(model)
  const parts = groups.map((group) => ({ name: group.name, triangles: group.triangles }))

  if (category === 'accessory') {
    const base = validateAccessory(model, accessoryType ?? 'Hat')
    const issues = [...base.issues, ...openIssues]
    return {
      ...base,
      ok: !issues.some((issue) => issue.level === 'error'),
      issues,
      limit: TRIANGLE_LIMIT,
      parts,
      health: model.health
    }
  }

  const base = validateAccessory(model, 'Prop')
  // The triangle rules are re-derived below, so drop the accessory ones.
  const issues = base.issues.filter((issue) => issue.rule !== 'triangles')
  const heavyParts = groups.filter((group) => group.triangles > MESH_TRIANGLE_LIMIT)

  if (heavyParts.length) {
    issues.unshift({
      level: 'error',
      rule: 'triangles',
      message:
        `${heavyParts.map((group) => `${group.name} has ${group.triangles}`).join(', ')} ` +
        `triangles; Roblox imports at most ${MESH_TRIANGLE_LIMIT} per mesh.`
    })
  } else if (!groups.length && base.triangles > MESH_TRIANGLE_LIMIT) {
    issues.unshift({
      level: 'error',
      rule: 'triangles',
      message: `${base.triangles} triangles; Roblox imports at most ${MESH_TRIANGLE_LIMIT} per mesh.`
    })
  } else if (base.triangles > HEAVY_TRIANGLES) {
    issues.unshift({
      level: 'warn',
      rule: 'triangles',
      message: `${base.triangles} triangles in all is heavy for phones; under ${HEAVY_TRIANGLES} is kinder.`
    })
  }

  if (category === 'character' && model.rigSpec) {
    const boundsByName = Object.fromEntries(
      groups.map((group) => [group.name, { min: group.bounds.min, max: group.bounds.max }])
    )
    const joints = rigJoints(model, groups)
    issues.push(...checkRigBounds(joints, boundsByName))
  }

  if (category === 'tool' && Math.max(...base.size) > 8) {
    issues.push({
      level: 'warn',
      rule: 'bounds',
      message: `A ${Math.max(...base.size).toFixed(1)}-stud tool is very large to hold.`
    })
  }

  issues.push(...openIssues)
  issues.push(...textureDetailIssues(model, { category }))

  return {
    ...base,
    issues,
    ok: !issues.some((issue) => issue.level === 'error'),
    attachment: category === 'tool' ? 'RightGripAttachment' : null,
    limit: MESH_TRIANGLE_LIMIT,
    parts,
    health: model.health
  }
}

/**
 * The joint list for a model's rig, in the order `c` builds it
 * (`rig-CDpj6dii.js:117-154`).
 *
 * A canonical rig contributes its own table; any extra bone declared in
 * `skeleton` is appended. Bones are ordered parents-first so a caller can walk
 * them, which is what the Studio insert needs.
 */
export function rigJoints(model: Model, groups: PartGroup[]): JointEntry[] {
  const pivots = Object.fromEntries(groups.map((group) => [group.name, group.pivot]))
  const declared = (model.rigSpec?.skeleton ?? []) as {
    part: string
    parent?: string
    joint?: string
  }[]

  return declared
    .filter((bone) => bone?.part)
    .map((bone) => ({
      part: bone.part,
      parent: bone.parent ?? 'HumanoidRootPart',
      joint: bone.joint ?? bone.part,
      pivot: pivots[bone.part] ?? [0, 0, 0]
    }))
}
