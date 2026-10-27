/**
 * The clothing engine behind `designLoop`.
 *
 * `build(design)` is the validator contract: it returns a `BuildResult` on
 * success and **throws** an error carrying `problems: string[]` when the design
 * is invalid. That throw is the whole self-correction mechanism — the loop
 * echoes those strings back to the model and re-asks.
 *
 * Nothing here talks to a model or a canvas element: `renderPixels` is pure, so
 * the same design always yields the same bytes.
 */

import type { BuildResult } from '../../types'
import { coverage, distinctColors, regionSummary, renderPixels, sheetSize } from './render'
import {
  type ClothingDesign,
  type DesignType,
  LIMITS,
  normalizeDesign,
  validateDesign
} from './schema'

/** A design that failed validation, in the shape the loop expects. */
export class DesignRejected extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.name = 'DesignRejected'
    this.problems = problems
  }
}

/** Flat-colour designs are legal but rarely what the user asked for. */
const MIN_DISTINCT_COLORS = 2
const MIN_COVERAGE = 0.05

export interface ClothingBuildOptions {
  /** Decided by the tool call, never by the model. */
  type: DesignType
  /** Attached pictures, for image-layer index validation. */
  images?: number
}

/**
 * Validate, render, and describe the result.
 *
 * The `report.issues` entries are non-fatal warnings: the loop only rejects a
 * `DONE` on `level: 'error'`, so a flat design surfaces in `facts` without
 * blocking acceptance.
 */
export function buildClothing(
  spec: unknown,
  { type, images = 0 }: ClothingBuildOptions
): BuildResult {
  const normalized = normalizeDesign(spec as ClothingDesign, type)
  const problems = validateDesign(normalized, { images })
  if (problems.length) throw new DesignRejected(problems)

  const rendered = renderPixels(normalized)
  const size = sheetSize(type)
  const painted = coverage(rendered)
  const colors = distinctColors(rendered)

  const issues: Array<{ level: 'error' | 'warn'; message: string }> = []
  if (painted < MIN_COVERAGE) {
    issues.push({
      level: 'warn',
      message: `the design covers only ${(painted * 100).toFixed(1)}% of the sheet`
    })
  }
  if (colors < MIN_DISTINCT_COLORS) {
    issues.push({ level: 'warn', message: 'the design is a single flat colour' })
  }
  if ((normalized.layers?.length ?? 0) >= LIMITS.layers) {
    issues.push({ level: 'warn', message: `the design is at the ${LIMITS.layers}-layer limit` })
  }

  return {
    spec: normalized,
    report: {
      ok: issues.every((issue) => issue.level !== 'error'),
      issues,
      width: size.width,
      height: size.height,
      coverage: Number(painted.toFixed(4)),
      colors
    },
    layout: [
      `Sheet ${size.width}x${size.height}, garment ${type}.`,
      `${normalized.layers?.length ?? 0} layer(s).`,
      `Painted ${(painted * 100).toFixed(1)}% with ${colors} distinct colour(s).`,
      `Regions: ${regionSummary(type)}.`
    ].join(' ')
  }
}
