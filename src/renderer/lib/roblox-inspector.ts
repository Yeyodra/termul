/**
 * What the Inspector reports about one garment version.
 *
 * Everything here comes from what the host already wrote into `item.json` plus
 * the engine's own layout tables — no new disk reads, and no render. The one
 * number that genuinely needs pixels ("regions painted") is left to the caller,
 * because only it holds the atlas canvas.
 *
 * The pixel scan copies `check.ts` on purpose: same sample grid, same alpha
 * cut-off, same empty threshold. An Inspector that disagreed with the engine's
 * own report would be worse than no Inspector.
 *
 * Kept pure so the tabs can be tested without a DOM or a filesystem.
 */

import type { RecordVersion } from '@/lib/artifact-records'
import {
  type Region,
  regionsFor,
  resolveTarget,
  SHEET_DIMENSIONS
} from '@/lib/generator/engines/clothing/layout'
import { type DesignType, LIMITS } from '@/lib/generator/engines/clothing/schema'

export interface LayerFacts {
  /** 1-based position, matching how the engine paints them. */
  n: number
  kind: string
  target: string
  color: string | null
  opacity: number | null
  hidden: boolean
}

export interface RegionFacts {
  id: string
  part: string
  face: string
  /** How many visible layers name this region. */
  layers: number
}

export interface VersionFacts {
  n: number
  at: number
  prompt: string
  ok: boolean
  /** `false` when the version carries no design this build can read. */
  readable: boolean
  type: DesignType
  size: { width: number; height: number }
  layerCount: number
  layerLimit: number
  layers: LayerFacts[]
  regions: RegionFacts[]
  /** Regions no visible layer targets. */
  untouched: string[]
}

const TYPES: readonly DesignType[] = ['shirt', 'pants', 'tshirt']

/** Same constants as `check.ts`, so the two never disagree. */
const SAMPLE_STEP = 4
const ALPHA_PAINTED = 16
export const EMPTY_FRACTION = 0.05

function designOf(version: RecordVersion): { type: DesignType; layers: unknown[] } | null {
  const design = version.design as { type?: unknown; layers?: unknown } | null | undefined
  if (!design || typeof design !== 'object') return null
  const type = TYPES.find((candidate) => candidate === design.type)
  if (!type) return null
  return { type, layers: Array.isArray(design.layers) ? design.layers : [] }
}

function layerFacts(layers: unknown[]): LayerFacts[] {
  return layers.map((raw, index) => {
    const layer = (raw ?? {}) as Record<string, unknown>
    return {
      n: index + 1,
      kind: typeof layer.kind === 'string' ? layer.kind : 'unknown',
      target: typeof layer.target === 'string' ? layer.target : 'all',
      color: typeof layer.color === 'string' ? layer.color : null,
      opacity: typeof layer.opacity === 'number' ? layer.opacity : null,
      hidden: layer.hidden === true
    }
  })
}

/**
 * Which regions the design touches, and which it leaves alone.
 *
 * A region is touched when at least one visible layer resolves to it, so
 * `target: "all"` alone marks every region — which is what the engine does too.
 */
function regionFacts(type: DesignType, layers: LayerFacts[]): RegionFacts[] {
  const counts = new Map<string, number>()
  for (const layer of layers) {
    if (layer.hidden) continue
    for (const region of resolveTarget(type, layer.target)) {
      counts.set(region.id, (counts.get(region.id) ?? 0) + 1)
    }
  }
  return regionsFor(type).map((region: Region) => ({
    id: region.id,
    part: region.part,
    face: region.face,
    layers: counts.get(region.id) ?? 0
  }))
}

export function versionFacts(version: RecordVersion): VersionFacts {
  const design = designOf(version)
  const type = design?.type ?? 'shirt'
  const layers = design ? layerFacts(design.layers) : []
  const regions = design ? regionFacts(type, layers) : []

  return {
    n: version.n,
    at: version.at,
    prompt: version.prompt?.trim() ?? '',
    ok: version.ok !== false,
    readable: design !== null,
    type,
    size: SHEET_DIMENSIONS[type],
    layerCount: layers.length,
    layerLimit: LIMITS.layers,
    layers,
    regions,
    untouched: regions.filter((region) => region.layers === 0).map((region) => region.id)
  }
}

/**
 * The fraction of each region the atlas actually paints, 0..1.
 *
 * The design alone cannot answer this: a layer that resolves to a region may
 * still draw nothing visible there. This is the same scan `checkDesign` runs,
 * so "painted" in the Inspector means exactly what it means in the engine.
 */
export function paintedByRegion(
  type: DesignType,
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Record<string, number> {
  const painted: Record<string, number> = {}
  for (const region of regionsFor(type)) {
    let hit = 0
    let total = 0
    const xEnd = Math.min(region.x + region.w, width)
    const yEnd = Math.min(region.y + region.h, height)
    for (let y = Math.max(0, region.y); y < yEnd; y += SAMPLE_STEP) {
      for (let x = Math.max(0, region.x); x < xEnd; x += SAMPLE_STEP) {
        total += 1
        if (pixels[(y * width + x) * 4 + 3]! > ALPHA_PAINTED) hit += 1
      }
    }
    painted[region.id] = total === 0 ? 0 : hit / total
  }
  return painted
}

export interface PaintReport {
  painted: number
  total: number
  /** Region ids the atlas leaves bare. */
  empty: string[]
}

export function paintReport(type: DesignType, painted: Record<string, number>): PaintReport {
  const regions = regionsFor(type)
  const empty =
    type === 'tshirt'
      ? []
      : regions
          .filter((region) => (painted[region.id] ?? 0) < EMPTY_FRACTION)
          .map((region) => region.id)
  return { painted: regions.length - empty.length, total: regions.length, empty }
}
