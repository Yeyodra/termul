/**
 * The clothing design schema and its validator.
 *
 * The validator is a pure collector: it returns every problem it finds and
 * never clamps. That matters because the loop echoes those strings straight
 * back to the model, so the wording is part of the contract.
 *
 * Ported from `design-PKArvEjc.js:3-76`; see
 * `re/full-reverse/02-clothing/REPORT.md` §1-§2.
 */

export const DESIGN_TYPES = ['shirt', 'pants', 'tshirt'] as const
export type DesignType = (typeof DESIGN_TYPES)[number]

export const LAYER_KINDS = [
  'solid',
  'gradient',
  'stripes',
  'checks',
  'plaid',
  'polka',
  'zigzag',
  'camo',
  'noise',
  'text',
  'image',
  'shape',
  'trim'
] as const

export const SHAPES = ['rect', 'circle', 'star', 'heart', 'diamond', 'triangle'] as const
export const FONTS = ['sans', 'serif', 'mono', 'display'] as const
export const EDGES = ['top', 'bottom', 'left', 'right', 'all', 'sides'] as const

export const LIMITS = { layers: 40, text: 60 } as const

const COLOR_RE = /^#[0-9a-f]{6}$/i

/** The parts each garment type has, used to answer "does this target exist". */
const PARTS: Record<DesignType, string[]> = {
  shirt: ['torso', 'right_arm', 'left_arm'],
  pants: ['torso', 'right_leg', 'left_leg'],
  tshirt: ['torso']
}

const SIDES = ['front', 'back', 'left', 'right', 'up', 'down']

/** A design as the model authors it. Only `type` and `layers` are required. */
export interface ClothingDesign {
  type: DesignType
  background?: string | null
  name?: string
  layers: ClothingLayer[]
}

export interface ClothingLayer {
  id?: string
  name?: string
  kind: string
  target?: string
  color?: string | null
  color2?: string | null
  color3?: string | null
  from?: string | null
  to?: string | null
  outline?: string | null
  outlineWidth?: number
  x?: number
  y?: number
  w?: number
  h?: number
  opacity?: number
  size?: number
  gap?: number
  angle?: number
  seed?: number
  text?: string
  font?: string
  weight?: number
  offsetX?: number
  offsetY?: number
  shape?: string
  edge?: string
  width?: number
  image?: number
  src?: string
  fit?: string
  scale?: number
  hidden?: boolean
  locked?: boolean
  [key: string]: unknown
}

/** The region ids a design type exposes. */
export function regionIds(type: DesignType): string[] {
  return PARTS[type]
}

/**
 * Does `target` name at least one region of `type`?
 *
 * Static targets are `all`, a part name, or a side. A region id counts too,
 * because the full atlas is per-garment and resolved at render time.
 */
export function targetResolves(type: DesignType, target: string): boolean {
  if (target === 'all') return true
  if (PARTS[type].includes(target)) return true
  if (SIDES.includes(target)) return true
  return target.includes('_') && PARTS[type].some((part) => target.startsWith(part))
}

function partList(type: DesignType): string {
  return [...new Set(PARTS[type])].join(', ')
}

/**
 * Every problem with a design, in the order the original reports them.
 *
 * Returns `[]` when the design is valid. The strings are echoed to the model
 * verbatim, so do not reword them.
 */
export function validateDesign(
  design: unknown,
  { images = 0 }: { images?: number } = {}
): string[] {
  const problems: string[] = []
  const fail = (field: string, message: string) => problems.push(`${field}: ${message}`)

  if (!design || typeof design !== 'object') {
    return ['the design is not an object']
  }

  const candidate = design as Partial<ClothingDesign>

  if (!DESIGN_TYPES.includes(candidate.type as DesignType)) {
    fail('type', `must be one of ${DESIGN_TYPES.join(', ')}`)
  }
  if (candidate.background != null && !COLOR_RE.test(String(candidate.background))) {
    fail('background', 'must be #rrggbb or null')
  }
  if (!Array.isArray(candidate.layers) || !candidate.layers.length) {
    fail('layers', 'needs at least one layer')
  }
  if ((candidate.layers?.length ?? 0) > LIMITS.layers) {
    fail('layers', `at most ${LIMITS.layers}`)
  }

  const type = (
    DESIGN_TYPES.includes(candidate.type as DesignType) ? candidate.type : 'shirt'
  ) as DesignType

  const checkColor = (field: string, value: unknown) => {
    if (value != null && !COLOR_RE.test(String(value))) {
      fail(field, `"${value}" is not a #rrggbb colour`)
    }
  }
  const checkUnit = (field: string, value: unknown) => {
    if (value != null && (!(Number(value) >= 0) || !(Number(value) <= 1))) {
      fail(field, 'must be a number from 0 to 1')
    }
  }
  const checkRange = (field: string, value: unknown, low: number, high: number) => {
    if (value != null && (!(Number(value) >= low) || !(Number(value) <= high))) {
      fail(field, `must be a number from ${low} to ${high}`)
    }
  }

  const layers = Array.isArray(candidate.layers) ? candidate.layers : []

  layers.forEach((layer, index) => {
    const at = `layers[${index}]`

    if (!layer || typeof layer !== 'object') {
      fail(at, 'is not an object')
      return
    }

    if (!LAYER_KINDS.includes(layer.kind as (typeof LAYER_KINDS)[number])) {
      fail(`${at}.kind`, `"${layer.kind}" is not one of ${LAYER_KINDS.join(', ')}`)
      return
    }

    const target = layer.target ?? 'all'
    if (!targetResolves(type, String(target))) {
      fail(
        `${at}.target`,
        `"${layer.target}" names no region of a ${type}; use all, a part (${partList(type)}), a side (${SIDES.join(', ')}) or a region id`
      )
    }

    for (const field of ['color', 'color2', 'color3', 'from', 'to', 'outline']) {
      checkColor(`${at}.${field}`, layer[field])
    }
    for (const field of ['x', 'y', 'w', 'h', 'opacity']) {
      checkUnit(`${at}.${field}`, layer[field])
    }
    checkRange(`${at}.size`, layer.size, 1, 400)
    checkRange(`${at}.gap`, layer.gap, 0, 400)
    checkRange(`${at}.angle`, layer.angle, -360, 360)

    if (layer.kind === 'text') {
      if (!layer.text || String(layer.text).length > LIMITS.text) {
        fail(`${at}.text`, `1 to ${LIMITS.text} characters`)
      }
      if (layer.font && !FONTS.includes(layer.font as (typeof FONTS)[number])) {
        fail(`${at}.font`, `one of ${FONTS.join(', ')}`)
      }
    }

    if (layer.kind === 'shape' && layer.shape && !SHAPES.includes(layer.shape as never)) {
      fail(`${at}.shape`, `one of ${SHAPES.join(', ')}`)
    }

    if (layer.kind === 'trim' && layer.edge && !EDGES.includes(layer.edge as never)) {
      fail(`${at}.edge`, 'one of top, bottom, left, right, sides, all')
    }

    if (layer.kind === 'image') {
      if (layer.image == null && !layer.src) {
        const range = images > 1 ? `0..${images - 1}` : '0'
        fail(at, `an image layer needs "image": the number of an attached picture (${range})`)
      } else if (
        layer.image != null &&
        (!Number.isInteger(layer.image) || layer.image < 0 || layer.image >= images)
      ) {
        fail(
          `${at}.image`,
          images ? `must be 0..${images - 1}` : 'no pictures are attached; remove this layer'
        )
      }
    }
  })

  return problems
}

/**
 * The loop's `normalize` hook: the garment type is decided by the tool call, so
 * the model can never change it (`clothing-62l72JIa.js:125-128`).
 */
export function normalizeDesign(design: ClothingDesign, type: DesignType): ClothingDesign {
  return { ...design, type }
}
