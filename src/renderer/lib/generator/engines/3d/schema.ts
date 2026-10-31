/**
 * The 3D spec schema, its limits, and its validator.
 *
 * Ported from `spec-D11M_y_m.js:419-685` (the `X` validator, the `J` limits and
 * the type namespaces) and `rig-CDpj6dii.js:1-116` (`checkRig`). See
 * `re/full-reverse/08-3d-polyforge/REPORT.md` §1-§3 and §2 for the tables, and
 * §12.9 for the full issue catalogue.
 *
 * The validator is a pure collector: it returns every problem it finds and never
 * clamps. That matters because the loop echoes those strings straight back to
 * the model, so the wording is part of the contract. `build.ts` is what throws
 * (see `ModelRejected` there).
 *
 * Two deliberate quirks are reproduced, not fixed — see the notes on
 * `unknownTypeMessage` and `capsule` below.
 */
import { evaluate, type ParamValues } from './expr'

/** The 12 primitive node types (`le`, `spec-D11M_y_m.js:421`). */
export const PRIMITIVE_TYPES = [
  'box',
  'roundedBox',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'capsule',
  'extrude',
  'lathe',
  'tube',
  'sweep',
  'text'
] as const

/** The 4 container node types — separate `switch` arms, not part of `le`. */
export const CONTAINER_TYPES = ['group', 'boolean', 'template', 'mesh'] as const

/** All 16 node types, in the order the prompt should list them. */
export const NODE_TYPES = [...PRIMITIVE_TYPES, ...CONTAINER_TYPES] as const

/** The 8 outline types an `extrude`/`sweep` shape may use (`q`, `:422`). */
export const SHAPES = [
  'rect',
  'roundedRect',
  'circle',
  'polygon',
  'star',
  'heart',
  'ring',
  'points'
] as const

/** The 6 spec categories (`G`, `:419`). */
export const CATEGORIES = ['accessory', 'prop', 'building', 'tool', 'text', 'character'] as const

/** The 8 accessory types (`K`, `:420`). */
export const ACCESSORY_TYPES = [
  'Hat',
  'Hair',
  'Face',
  'Neck',
  'Shoulder',
  'Front',
  'Back',
  'Waist'
] as const

/** The 3 rigs a character may declare (`rig-CDpj6dii.js:1`). */
export const RIGS = ['R15', 'R6', 'custom'] as const

/** The 3 boolean operations (`Object.keys(V)`, `spec-D11M_y_m.js:389`). */
export const BOOLEAN_OPS = ['union', 'subtract', 'intersect'] as const

/**
 * The 10 template ids in the catalog (`templates-Cm7rjk-r.js:415-665`, keyed by
 * `Q` at `:666`). The validator only needs the ids to answer "does this
 * template exist" — the builders belong to `build.ts`.
 */
export const TEMPLATE_IDS = [
  'health-bar',
  'halo',
  'top-hat',
  'crown',
  'cat-ears',
  'wings',
  'backpack',
  'waist-sword',
  'sword',
  'text-logo'
] as const

/** The `J` limits (`spec-D11M_y_m.js:423-433`). */
export const LIMITS = {
  /** Total numbers across all `mesh.positions`; divided by 9 = 20 000 triangles. */
  meshNumbers: 180000,
  /** Total node count over all `parts` subtrees. */
  nodes: 400,
  /** `group.array.count`. */
  arrayCount: 64,
  /** Nesting depth, root = 0. */
  depth: 8,
  /** `shape.points` count. */
  points: 200,
  /** Characters in `text.text`. */
  text: 40,
  /** Value bound: any single scalar may not exceed extent x 10 = 2000. */
  extent: 200,
  /** Number of `boolean` nodes. */
  booleans: 16,
  /** Summed child triangles of one boolean. */
  booleanTriangles: 4000
} as const

/**
 * Limits that live outside `J` (`08` §2.1) but are enforced by this validator
 * or by the builder. Kept together so a caller never has to hunt for them.
 */
export const EXTRA_LIMITS = {
  /** Part name length (`spec-D11M_y_m.js:568`). */
  partName: 40,
  /** Palette size (`:493`). */
  palette: 64,
  /** Textured palette colours — they share one 1024-squared atlas (`:490`). */
  textured: 8,
  /** Entries in `textures` (`:463`). */
  textures: 8,
  /** `palette.<name>.tile`, studs per repeat (`:480`). */
  tileMin: 0.1,
  tileMax: 200
} as const

const COLOR_RE = /^#[0-9a-f]{6}$/i
const PARAM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One node in a spec. Only `type` is structurally required. */
export interface SpecNode {
  type: string
  name?: string
  color?: string
  position?: unknown
  rotation?: unknown
  scale?: unknown
  pivot?: unknown
  hidden?: boolean
  locked?: boolean
  order?: number
  // primitives
  size?: unknown
  radius?: unknown
  radiusTop?: unknown
  radiusBottom?: unknown
  height?: unknown
  tube?: unknown
  length?: unknown
  depth?: unknown
  bevel?: unknown
  shape?: ShapeSpec
  profile?: unknown
  path?: unknown
  text?: string
  // containers
  children?: SpecNode[]
  mirror?: 'x' | 'z'
  array?: { count?: unknown; radial?: boolean; step?: unknown }
  op?: string
  id?: string
  params?: Record<string, unknown>
  positions?: unknown
  open?: boolean
  [key: string]: unknown
}

/** One outline in the shape sub-language. */
export interface ShapeSpec {
  type: string
  w?: unknown
  h?: unknown
  radius?: unknown
  sides?: unknown
  points?: unknown
  outer?: unknown
  inner?: unknown
  size?: unknown
  [key: string]: unknown
}

/** One palette entry: a flat `#rrggbb`, or a textured reference. */
export type PaletteEntry = string | { texture: string; tile?: number; tint?: string }

/** One bone in a custom rig. */
export interface SkeletonEntry {
  part: string
  parent?: string
  joint?: string
  axis?: number[]
  limits?: [number, number]
  [key: string]: unknown
}

/** A parameter exposed to the UI as a slider. */
export interface ParamSpec {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  unit?: string
  [key: string]: unknown
}

/** A texture source: a workspace file, or an image-engine spec. */
export type TextureSpec = { path?: string; image?: unknown }

/** A 3D spec as the model authors it. */
export interface ModelSpec {
  version: 1
  name?: string
  category: (typeof CATEGORIES)[number]
  accessoryType?: (typeof ACCESSORY_TYPES)[number]
  rig?: (typeof RIGS)[number]
  skeleton?: SkeletonEntry[]
  palette: Record<string, PaletteEntry>
  textures?: Record<string, TextureSpec>
  params?: Record<string, ParamSpec>
  parts: SpecNode[]
  motion?: { clips?: Record<string, unknown> }
  source?: string
  [key: string]: unknown
}

/**
 * Resolve parameter values, clamped into each param's own `[min, max]`
 * (`Z`, `spec-D11M_y_m.js:686-699`).
 *
 * A slider override can therefore never push a param out of range, which is why
 * `$param` binding needs no range check of its own.
 */
export function paramValues(
  spec: { params?: Record<string, ParamSpec> } | null | undefined,
  overrides: Record<string, unknown> = {}
): ParamValues {
  const resolved: ParamValues = {}
  for (const [key, param] of Object.entries(spec?.params ?? {})) {
    let value = Number(overrides[key] ?? param?.value)
    if (typeof param?.min === 'number') value = Math.max(param.min, value)
    if (typeof param?.max === 'number') value = Math.min(param.max, value)
    resolved[key] = value
  }
  return resolved
}

/**
 * The canonical R15 joint table (`rig-CDpj6dii.js:3-7`).
 *
 * `HumanoidRootPart` is the implicit parent of the first bone, so it is named
 * here rather than in the table.
 */
export const R15_JOINTS: SkeletonEntry[] = (
  [
    ['LowerTorso', 'HumanoidRootPart', 'Root'],
    ['UpperTorso', 'LowerTorso', 'Waist'],
    ['Head', 'UpperTorso', 'Neck'],
    ['LeftUpperArm', 'UpperTorso', 'LeftShoulder'],
    ['LeftLowerArm', 'LeftUpperArm', 'LeftElbow'],
    ['LeftHand', 'LeftLowerArm', 'LeftWrist'],
    ['RightUpperArm', 'UpperTorso', 'RightShoulder'],
    ['RightLowerArm', 'RightUpperArm', 'RightElbow'],
    ['RightHand', 'RightLowerArm', 'RightWrist'],
    ['LeftUpperLeg', 'LowerTorso', 'LeftHip'],
    ['LeftLowerLeg', 'LeftUpperLeg', 'LeftKnee'],
    ['LeftFoot', 'LeftLowerLeg', 'LeftAnkle'],
    ['RightUpperLeg', 'LowerTorso', 'RightHip'],
    ['RightLowerLeg', 'RightUpperLeg', 'RightKnee'],
    ['RightFoot', 'RightLowerLeg', 'RightAnkle']
  ] as const
).map(([part, parent, joint]) => ({ part, parent, joint }))

/**
 * The canonical R6 joint table (`rig-CDpj6dii.js:8-12`).
 *
 * Note the R6 part names contain **spaces** — an R6 spec must name its parts
 * that way, and `*RigAttachment` strips them (`rig-CDpj6dii.js:17`).
 */
export const R6_JOINTS: SkeletonEntry[] = (
  [
    ['Torso', 'HumanoidRootPart', 'RootJoint'],
    ['Head', 'Torso', 'Neck'],
    ['Left Arm', 'Torso', 'Left Shoulder'],
    ['Right Arm', 'Torso', 'Right Shoulder'],
    ['Left Leg', 'Torso', 'Left Hip'],
    ['Right Leg', 'Torso', 'Right Hip']
  ] as const
).map(([part, parent, joint]) => ({ part, parent, joint }))

/** Canonical joints per rig; `custom` has none. */
export const RIG_JOINTS: Record<string, SkeletonEntry[]> = {
  R15: R15_JOINTS,
  R6: R6_JOINTS
}

/**
 * The "unknown type" message.
 *
 * **Quirk reproduced deliberately (`08` §15 B1):** the original lists only the
 * 12 primitives plus `group`, `boolean`, `template` — `mesh` is accepted by its
 * own `switch` arm but omitted from this message (`spec-D11M_y_m.js:680`). The
 * plan says to pick one and record it; we keep the original wording so a model
 * that has seen the real engine sees the same strings. Fixing it would be a
 * one-line change if the omission ever confuses a model.
 */
function unknownTypeMessage(type: unknown): string {
  const listed = [...PRIMITIVE_TYPES, 'group', 'boolean', 'template'].join(', ')
  return `"${type}" is not one of ${listed}`
}

/**
 * Validate a character's rig (`checkRig`, `rig-CDpj6dii.js:32-116`).
 *
 * Only runs for `category: 'character'`; every other category has no bones.
 * The rules, in order: a known `rig`; every part named and pivoted; unique
 * names; the canonical part set for R15/R6; a complete skeleton for `custom`;
 * and per-bone `part`/`parent`/`joint`/`axis`/`limits` sanity.
 */
export function checkRig(spec: Partial<ModelSpec>): string[] {
  const problems: string[] = []
  const fail = (field: string, message: string) => problems.push(`${field}: ${message}`)

  if (spec.category !== 'character') return problems

  if (!RIGS.includes(spec.rig as (typeof RIGS)[number])) {
    fail('rig', `a character needs "rig": ${RIGS.join(', ')}`)
    return problems
  }

  const names = (spec.parts ?? []).map((part) => part?.name).filter(Boolean) as string[]

  ;(spec.parts ?? []).forEach((part, index) => {
    if (!part?.name) {
      fail(`parts[${index}].name`, 'every part of a rigged character is named (its bone)')
    }
    if (!part?.pivot) {
      fail(`parts[${index}].pivot`, 'every part of a rigged character has a pivot at its joint')
    }
  })

  const duplicated = names.filter((name, index) => names.indexOf(name) !== index)
  if (duplicated.length) {
    fail('parts', `part names must be unique (${[...new Set(duplicated)].join(', ')})`)
  }

  if (spec.rig === 'R15' || spec.rig === 'R6') {
    const canonical = RIG_JOINTS[spec.rig].map((entry) => entry.part)
    const missing = canonical.filter((part) => !names.includes(part))
    if (missing.length) {
      fail(
        'parts',
        `an ${spec.rig} body has these parts, by these exact names: ${missing.join(', ')} missing`
      )
    }
    const extra = names.filter(
      (name) =>
        !canonical.includes(name) && !(spec.skeleton ?? []).some((bone) => bone.part === name)
    )
    if (extra.length) {
      fail(
        'parts',
        `${extra.join(', ')}: not an ${spec.rig} part; add it to "skeleton" with its parent ` +
          "(an extra bone, e.g. a tail) or put it inside a body part's group"
      )
    }
  }

  const skeleton = spec.skeleton ?? []
  if (spec.rig === 'custom' && !skeleton.length) {
    fail('skeleton', 'a custom rig lists its bones: [{ "part", "parent", "joint" }]')
  }

  const known = new Set<string>([...names, 'HumanoidRootPart'])
  const parentOf = new Map<string, string | null>()

  skeleton.forEach((bone, index) => {
    const at = `skeleton[${index}]`
    if (!bone?.part || !names.includes(bone.part)) {
      fail(`${at}.part`, `"${bone?.part}" is not a named part`)
    }
    if (bone?.parent != null && !known.has(bone.parent)) {
      fail(`${at}.parent`, `"${bone.parent}" is not a part (or HumanoidRootPart)`)
    }
    if (
      bone?.joint != null &&
      (typeof bone.joint !== 'string' || !bone.joint.trim() || bone.joint.length > 40)
    ) {
      fail(`${at}.joint`, 'a joint name is 1 to 40 characters')
    }
    if (bone?.axis != null && (!Array.isArray(bone.axis) || bone.axis.length !== 3)) {
      fail(`${at}.axis`, '[x, y, z]: the main axis it bends about')
    }
    if (
      bone?.limits != null &&
      (!Array.isArray(bone.limits) ||
        bone.limits.length !== 2 ||
        !(bone.limits[0] <= bone.limits[1]))
    ) {
      fail(`${at}.limits`, '[min, max] degrees')
    }
    if (bone?.part) parentOf.set(bone.part, bone.parent ?? null)
  })

  if (spec.rig === 'custom') {
    const notBones = names.filter((name) => !parentOf.has(name))
    if (notBones.length) {
      fail('skeleton', `every part is a bone: ${notBones.join(', ')} not in the skeleton`)
    }
    const roots = [...parentOf].filter(
      ([, parent]) => parent == null || parent === 'HumanoidRootPart'
    )
    if (roots.length !== 1) {
      fail(
        'skeleton',
        'exactly one bone hangs from HumanoidRootPart (or has no parent): the body/pelvis; ' +
          `found ${roots.length ? roots.map(([part]) => part).join(', ') : 'none'}`
      )
    }
    for (const start of parentOf.keys()) {
      const seen = new Set<string>()
      let at: string | null | undefined = start
      while (at && at !== 'HumanoidRootPart' && parentOf.has(at)) {
        if (seen.has(at)) {
          fail('skeleton', `a loop through ${start}`)
          break
        }
        seen.add(at)
        at = parentOf.get(at)
      }
    }
  }

  return problems
}

/**
 * Every problem with a spec, in the order the original reports them.
 *
 * Returns `[]` when the spec is valid. The strings are echoed to the model
 * verbatim, so do not reword them.
 */
export function validateSpec(spec: unknown): string[] {
  const problems: string[] = []
  const fail = (field: string, message: string) => problems.push(`${field}: ${message}`)

  if (!spec || typeof spec !== 'object') {
    return ['the spec is not an object']
  }

  const candidate = spec as Partial<ModelSpec>

  if (candidate.version !== 1) {
    fail('version', 'must be 1')
  }
  if (!CATEGORIES.includes(candidate.category as (typeof CATEGORIES)[number])) {
    fail('category', `must be one of ${CATEGORIES.join(', ')}`)
  }
  if (
    candidate.category === 'accessory' &&
    !ACCESSORY_TYPES.includes(candidate.accessoryType as (typeof ACCESSORY_TYPES)[number])
  ) {
    fail('accessoryType', `an accessory needs one of ${ACCESSORY_TYPES.join(', ')}`)
  }
  if (
    !candidate.palette ||
    typeof candidate.palette !== 'object' ||
    !Object.keys(candidate.palette).length
  ) {
    fail('palette', 'needs at least one colour')
  }

  const textures = candidate.textures ?? {}
  if (typeof textures !== 'object' || Array.isArray(textures)) {
    fail('textures', '{ "<name>": { "path": "images/x.png" } or { "image": <image spec> } }')
  } else {
    if (Object.keys(textures).length > EXTRA_LIMITS.textures) {
      fail('textures', `at most ${EXTRA_LIMITS.textures}`)
    }
    for (const [name, entry] of Object.entries(textures)) {
      const path = entry?.path
      const badPath =
        typeof path !== 'string' ||
        !/\.(png|jpe?g|webp)$/i.test(path) ||
        path.startsWith('/') ||
        path.split(/[\\/]/).includes('..')
      if (badPath && (!entry?.image || typeof entry.image !== 'object')) {
        fail(
          `textures.${name}`,
          'give "path" (a PNG/JPEG/WebP in the workspace) or "image" (an image engine spec, drawn at build)'
        )
      }
    }
  }

  let texturedCount = 0
  for (const [name, entry] of Object.entries(candidate.palette ?? {})) {
    if (entry && typeof entry === 'object') {
      texturedCount++
      if (!textures?.[entry.texture]) {
        fail(`palette.${name}.texture`, `"${entry.texture}" is not in "textures"`)
      }
      if (
        entry.tile != null &&
        (typeof entry.tile !== 'number' ||
          !(entry.tile >= EXTRA_LIMITS.tileMin) ||
          !(entry.tile <= EXTRA_LIMITS.tileMax))
      ) {
        fail(
          `palette.${name}.tile`,
          `studs per repeat, ${EXTRA_LIMITS.tileMin} to ${EXTRA_LIMITS.tileMax}`
        )
      }
      if (entry.tint != null && !COLOR_RE.test(String(entry.tint))) {
        fail(`palette.${name}.tint`, '#rrggbb')
      }
    } else if (!COLOR_RE.test(String(entry))) {
      fail(
        `palette.${name}`,
        `"${entry}" is not a #rrggbb colour (or { "texture": "<name>", "tile": 2 })`
      )
    }
  }
  if (texturedCount > EXTRA_LIMITS.textured) {
    fail(
      'palette',
      `at most ${EXTRA_LIMITS.textured} textured colours (they share one 1024\u00b2 texture)`
    )
  }
  if (Object.keys(candidate.palette ?? {}).length > EXTRA_LIMITS.palette) {
    fail('palette', `at most ${EXTRA_LIMITS.palette} colours`)
  }

  for (const [name, param] of Object.entries(candidate.params ?? {})) {
    if (!PARAM_KEY_RE.test(name)) {
      fail(`params.${name}`, 'names are letters, digits and _')
    }
    if (typeof param?.value !== 'number') {
      fail(`params.${name}.value`, 'must be a number')
    }
  }

  if (!Array.isArray(candidate.parts) || !candidate.parts.length) {
    fail('parts', 'needs at least one node')
  }

  if (candidate.category === 'character') {
    problems.push(...checkRig(candidate))
  } else if (candidate.skeleton != null) {
    fail('skeleton', 'only a "character" has a skeleton')
  }

  const params = paramValues(candidate)
  const paletteKeys = new Set(Object.keys(candidate.palette ?? {}))
  const templates = new Set<string>(TEMPLATE_IDS)
  /** Node count is global and monotone, and is incremented *before* the depth test. */
  let nodeCount = 0
  let booleanCount = 0

  /** `l` — evaluate one scalar and range-check it against the extent bound. */
  const scalar = (field: string, value: unknown) => {
    try {
      const result = evaluate(value, params)
      if (Math.abs(result) > LIMITS.extent * 10) {
        fail(field, `${result} is out of range`)
      }
    } catch (error) {
      fail(field, (error as Error).message)
    }
  }

  /** `u` — a fixed-length numeric tuple. */
  const tuple = (field: string, value: unknown, length = 3) => {
    if (!Array.isArray(value) || value.length !== length) {
      return fail(field, `must be [${length} numbers]`)
    }
    value.forEach((item, index) => {
      scalar(`${field}[${index}]`, item)
    })
  }

  /** `d` — the shape sub-language. */
  const shape = (field: string, value: unknown) => {
    const outline = value as ShapeSpec | undefined
    if (!outline || !SHAPES.includes(outline.type as (typeof SHAPES)[number])) {
      return fail(field, `shape.type must be one of ${SHAPES.join(', ')}`)
    }
    if (outline.type === 'points') {
      if (!Array.isArray(outline.points) || outline.points.length < 3) {
        return fail(`${field}.points`, 'needs 3 or more [x,y]')
      }
      if (outline.points.length > LIMITS.points) {
        fail(`${field}.points`, `at most ${LIMITS.points}`)
      }
      ;(outline.points as unknown[]).forEach((point, index) => {
        tuple(`${field}.points[${index}]`, point, 2)
      })
    }
    for (const key of ['w', 'h', 'radius', 'sides', 'outer', 'inner', 'size', 'points']) {
      if (key in outline && key !== 'points') {
        scalar(`${field}.${key}`, outline[key])
      }
    }
  }

  /** `f` — one node, recursing into children. */
  const node = (field: string, value: unknown, depth: number) => {
    nodeCount++
    if (nodeCount > LIMITS.nodes) {
      // Emitted once, on the 401st node.
      if (nodeCount === LIMITS.nodes + 1) {
        fail('parts', `more than ${LIMITS.nodes} nodes`)
      }
      return
    }
    if (depth > LIMITS.depth) {
      return fail(field, `nested deeper than ${LIMITS.depth}`)
    }
    if (!value || typeof value !== 'object') {
      return fail(field, 'is not an object')
    }

    const n = value as SpecNode

    if (n.color && !paletteKeys.has(n.color)) {
      fail(`${field}.color`, `"${n.color}" is not in the palette`)
    }
    if (n.name != null && (typeof n.name !== 'string' || !n.name.trim() || n.name.length > 40)) {
      fail(`${field}.name`, 'a part name is 1 to 40 characters')
    }
    if (n.pivot) tuple(`${field}.pivot`, n.pivot)
    if (n.position) tuple(`${field}.position`, n.position)
    if (n.rotation) tuple(`${field}.rotation`, n.rotation)
    if (Array.isArray(n.scale)) {
      tuple(`${field}.scale`, n.scale)
    } else if (n.scale !== undefined) {
      scalar(`${field}.scale`, n.scale)
    }

    // `array` and `mirror` are expanded by the builder's `group` branch only, so
    // on any other type they were accepted here and then silently dropped: a
    // `box` with `array.count: 9` built one part, not nine. Reject them instead,
    // and say what to do, because the failure is otherwise invisible.
    if (n.type !== 'group') {
      if (n.array) {
        fail(`${field}.array`, 'only a "group" can repeat; wrap the node in a group')
      }
      if (n.mirror) {
        fail(`${field}.mirror`, 'only a "group" can mirror; wrap the node in a group')
      }
    }

    switch (n.type) {
      case 'group': {
        if (!Array.isArray(n.children) || !n.children.length) {
          fail(`${field}.children`, 'needs nodes')
        }
        if (n.mirror && !['x', 'z'].includes(n.mirror)) {
          fail(`${field}.mirror`, 'must be "x" or "z"')
        }
        if (n.array) {
          scalar(`${field}.array.count`, n.array.count)
          try {
            if (evaluate(n.array.count, params) > LIMITS.arrayCount) {
              fail(`${field}.array.count`, `at most ${LIMITS.arrayCount}`)
            }
          } catch {
            // `scalar` above already reported the parse error.
          }
          if (!n.array.radial) {
            // A missing step is validated as `[]`, so the message a model sees is
            // `must be [3 numbers]`, not a dedicated "step is required" string.
            tuple(`${field}.array.step`, n.array.step ?? [])
          }
        }
        ;(n.children ?? []).forEach((child, index) => {
          node(`${field}.children[${index}]`, child, depth + 1)
        })
        return
      }
      case 'template': {
        if (!templates.has(String(n.id))) {
          fail(`${field}.id`, `no template "${n.id}"`)
        }
        return
      }
      case 'boolean': {
        if (++booleanCount === LIMITS.booleans + 1) {
          fail(field, `more than ${LIMITS.booleans} boolean nodes`)
        }
        if (!BOOLEAN_OPS.includes(n.op as (typeof BOOLEAN_OPS)[number])) {
          fail(`${field}.op`, `must be one of ${BOOLEAN_OPS.join(', ')}`)
        }
        if (!Array.isArray(n.children) || n.children.length < 2) {
          fail(`${field}.children`, 'needs 2 or more nodes')
        }
        ;(n.children ?? []).forEach((child, index) => {
          node(`${field}.children[${index}]`, child, depth + 1)
        })
        return
      }
      case 'box':
        return tuple(`${field}.size`, n.size)
      case 'roundedBox':
        tuple(`${field}.size`, n.size)
        return scalar(`${field}.radius`, n.radius ?? 0.1)
      case 'sphere':
      // `capsule.length` is deliberately not validated here; the builder
      // defaults it to 0.5, so a capsule with no length is silently 0.5 long.
      // Quirk reproduced (`08` §15 B2) — see `build.ts`.
      case 'capsule':
        return scalar(`${field}.radius`, n.radius)
      case 'cylinder':
        scalar(`${field}.radiusTop`, n.radiusTop ?? n.radius)
        scalar(`${field}.radiusBottom`, n.radiusBottom ?? n.radius)
        return scalar(`${field}.height`, n.height)
      case 'cone':
        scalar(`${field}.radius`, n.radius)
        return scalar(`${field}.height`, n.height)
      case 'torus':
        scalar(`${field}.radius`, n.radius)
        return scalar(`${field}.tube`, n.tube ?? 0.1)
      case 'extrude':
        shape(`${field}.shape`, n.shape)
        // Unlike the builder (which defaults to 0.1), the validator requires it.
        return scalar(`${field}.depth`, n.depth)
      case 'lathe':
        if (!Array.isArray(n.profile) || n.profile.length < 2) {
          return fail(`${field}.profile`, 'needs 2 or more [radius, y]')
        }
        return (n.profile as unknown[]).forEach((pair, index) => {
          tuple(`${field}.profile[${index}]`, pair, 2)
        })
      case 'tube':
        if (!Array.isArray(n.path) || n.path.length < 2) {
          return fail(`${field}.path`, 'needs 2 or more [x,y,z]')
        }
        ;(n.path as unknown[]).forEach((point, index) => {
          tuple(`${field}.path[${index}]`, point)
        })
        return scalar(`${field}.radius`, n.radius)
      case 'sweep':
        shape(`${field}.shape`, n.shape)
        if (!Array.isArray(n.path) || n.path.length < 2) {
          return fail(`${field}.path`, 'needs 2 or more [x,y,z]')
        }
        return (n.path as unknown[]).forEach((point, index) => {
          tuple(`${field}.path[${index}]`, point)
        })
      case 'text':
        if (!n.text || String(n.text).length > LIMITS.text) {
          fail(`${field}.text`, `1 to ${LIMITS.text} characters`)
        }
        return scalar(`${field}.size`, n.size ?? 0.5)
      case 'mesh': {
        const positions = n.positions
        if (!Array.isArray(positions) || positions.length < 9 || positions.length % 9) {
          fail(`${field}.positions`, 'needs whole triangles (9 numbers each)')
        } else if (positions.length > LIMITS.meshNumbers) {
          fail(`${field}.positions`, `at most ${LIMITS.meshNumbers / 9} triangles`)
        } else if (positions.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
          fail(`${field}.positions`, 'has a value that is not a number')
        }
        ;(n.children ?? []).forEach((child, index) => {
          node(`${field}.children[${index}]`, child, depth + 1)
        })
        return
      }
      default:
        fail(`${field}.type`, unknownTypeMessage(n.type))
    }
  }

  ;(candidate.parts ?? []).forEach((part, index) => {
    node(`parts[${index}]`, part, 0)
  })

  return problems
}

/**
 * The loop's `normalize` hook (`gen3d-BAdfthxw.js:705-717`).
 *
 * `category` is decided by the tool call when the caller passes one, so the
 * model can never change what it is making. `accessoryType` is dropped for a
 * non-accessory, and a `character` with no `rig` gets `R15`.
 */
export function normalizeSpec(spec: ModelSpec, category?: string): ModelSpec {
  const normalized: ModelSpec = { ...spec }

  if (category) {
    normalized.category = category as ModelSpec['category']
  }

  if (normalized.category !== 'accessory') {
    delete normalized.accessoryType
  }

  if (normalized.category === 'character') {
    if (!RIGS.includes(normalized.rig as (typeof RIGS)[number])) {
      normalized.rig = 'R15'
    }
  } else {
    delete normalized.skeleton
    delete normalized.rig
    delete normalized.motion
  }

  return normalized
}
