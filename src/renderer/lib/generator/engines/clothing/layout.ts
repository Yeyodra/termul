/**
 * The region atlas: which rectangle of the 512x512 sheet each body part's face
 * occupies.
 *
 * Ported from `layout-yFs0_M_2.js:1-73`. Target resolution order matters and has
 * two sharp edges carried over deliberately:
 *
 *  - `"torso"` resolves as a **part** -> 6 regions
 *  - `"left"` / `"right"` / `"front"` resolve as a **face** -> 3 regions, so
 *    `target: "left"` means "every left-facing face", not the left arm
 */

import type { DesignType } from './schema'

export interface Region {
  id: string
  part: string
  face: string
  x: number
  y: number
  w: number
  h: number
}

/** Sheet edge length for the full-body garments. */
export const SHEET_SIZE = 512

/** PNG dimensions per garment type. */
export const SHEET_DIMENSIONS: Record<DesignType, { width: number; height: number }> = {
  shirt: { width: 585, height: 559 },
  pants: { width: 585, height: 559 },
  tshirt: { width: 512, height: 512 }
}

const TORSO: Region[] = [
  { id: 'torso_right', part: 'torso', face: 'right', x: 165, y: 74, w: 64, h: 128 },
  { id: 'torso_front', part: 'torso', face: 'front', x: 231, y: 74, w: 128, h: 128 },
  { id: 'torso_left', part: 'torso', face: 'left', x: 361, y: 74, w: 64, h: 128 },
  { id: 'torso_back', part: 'torso', face: 'back', x: 427, y: 74, w: 128, h: 128 },
  { id: 'torso_up', part: 'torso', face: 'up', x: 231, y: 8, w: 128, h: 64 },
  { id: 'torso_down', part: 'torso', face: 'down', x: 231, y: 204, w: 128, h: 64 }
]

function limb(part: string, x0: number, faces: string[], upX: number): Region[] {
  const side = faces.map((face, index) => ({
    id: `${part}_${face}`,
    part,
    face,
    x: x0 + index * 66,
    y: 355,
    w: 64,
    h: 128
  }))
  return [
    ...side,
    { id: `${part}_up`, part, face: 'up', x: upX, y: 289, w: 64, h: 64 },
    { id: `${part}_down`, part, face: 'down', x: upX, y: 485, w: 64, h: 64 }
  ]
}

const RIGHT = (part: string) => limb(part, 19, ['left', 'back', 'right', 'front'], 217)
const LEFT = (part: string) => limb(part, 308, ['front', 'left', 'back', 'right'], 308)

const TSHIRT: Region[] = [
  { id: 'graphic', part: 'torso', face: 'front', x: 0, y: 0, w: 512, h: 512 }
]

/** Every region a garment type has, in sheet order. */
export function regionsFor(type: DesignType): Region[] {
  switch (type) {
    case 'tshirt':
      return TSHIRT
    case 'pants':
      return [...TORSO, ...RIGHT('right_leg'), ...LEFT('left_leg')]
    default:
      return [...TORSO, ...RIGHT('right_arm'), ...LEFT('left_arm')]
  }
}

/**
 * Resolve a layer target to the regions it paints.
 *
 * Precedence: exact region id, then part name, then face name. The middle step
 * is why `"torso"` covers six regions while `"left"` covers three.
 */
export function resolveTarget(type: DesignType, target = 'all'): Region[] {
  const regions = regionsFor(type)
  if (target === 'all') return regions

  const byId = regions.filter((region) => region.id === target)
  if (byId.length) return byId

  const byPart = regions.filter((region) => region.part === target)
  if (byPart.length) return byPart

  return regions.filter((region) => region.face === target)
}

/**
 * The six faces of one body part, for UV mapping.
 *
 * Scoped to the part on purpose: `regionsFor` returns torso before limbs, and
 * several parts share face names, so a garment-wide `find(face)` hands a sleeve
 * the torso's atlas rectangle. That is a real bug this function exists to
 * prevent — it textured both arms with the chest.
 */
export function regionsForPart(type: DesignType, part: string): Region[] {
  return regionsFor(type).filter((region) => region.part === part)
}
