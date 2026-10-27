/**
 * `checkDesign` — the post-render QA pass whose prose the model reads back.
 *
 * Ported 1:1 from RobloxKit's `design-PKArvEjc.js` (`function f`). It is the
 * only thing in the whole engine that can tell a model *where* its garment is
 * bare, so the wording and the region ids are part of the contract.
 *
 * Two behaviours are easy to get wrong and are load-bearing:
 *
 *  - the scan samples every **4th pixel** on both axes and treats alpha > 16 as
 *    painted; a region under 5% painted is "empty", which is what produces
 *    "the skin shows there"
 *  - `ok` is `true` unless something is an `error`, and nothing here ever emits
 *    an `error` — so `ok` is always `true`. That is upstream's behaviour, not an
 *    oversight in this port.
 */

import { regionsFor } from './layout'
import type { ClothingDesign, DesignType } from './schema'

/** One non-fatal finding, shaped exactly as the model receives it. */
export interface DesignIssue {
  level: 'error' | 'warn'
  message: string
}

/** What `checkDesign` returns; `empty` and `size` are consumed by the layout text. */
export interface DesignCheck {
  ok: boolean
  issues: DesignIssue[]
  size: [number, number]
  /** Region ids whose painted fraction fell under the threshold. */
  empty: string[]
}

const SAMPLE_STEP = 4
const ALPHA_PAINTED = 16
const EMPTY_FRACTION = 0.05
const EMPTY_REPORTED = 8
const SMALL_TEXT_PX = 10
const TEXT_DEFAULT_PX = 32

/** Painted fraction of one region, sampled on the same grid as upstream. */
function paintedFraction(
  pixels: Uint8ClampedArray,
  sheetWidth: number,
  region: { x: number; y: number; w: number; h: number }
): number {
  let painted = 0
  for (let y = region.y; y < region.y + region.h; y += SAMPLE_STEP) {
    for (let x = region.x; x < region.x + region.w; x += SAMPLE_STEP) {
      if (pixels[(y * sheetWidth + x) * 4 + 3] > ALPHA_PAINTED) painted += 1
    }
  }
  const sampled = Math.ceil(region.h / SAMPLE_STEP) * Math.ceil(region.w / SAMPLE_STEP)
  return sampled ? painted / sampled : 0
}

/**
 * Check a rendered sheet against its design.
 *
 * `pixels` is the RGBA buffer `renderToCanvas` produced, so a vector-only design
 * is judged on what actually landed, not on the pattern pass alone.
 */
export function checkDesign(
  design: ClothingDesign,
  pixels: Uint8ClampedArray,
  sheetWidth: number,
  sheetHeight: number
): DesignCheck {
  const issues: DesignIssue[] = []
  const empty: string[] = []

  // A t-shirt is a single full-bleed graphic, so "empty region" is meaningless.
  if (design.type !== 'tshirt') {
    for (const region of regionsFor(design.type as DesignType)) {
      if (paintedFraction(pixels, sheetWidth, region) < EMPTY_FRACTION) {
        empty.push(region.id)
      }
    }

    if (empty.length) {
      const shown = empty.slice(0, EMPTY_REPORTED).join(', ')
      const ellipsis = empty.length > EMPTY_REPORTED ? '…' : ''
      issues.push({
        level: 'warn',
        message:
          `${empty.length} region${empty.length > 1 ? 's are' : ' is'} left empty, so the skin ` +
          `shows there: ${shown}${ellipsis}.`
      })
    }
  }

  const smallText = (design.layers ?? []).filter(
    (layer) => layer.kind === 'text' && Number(layer.size ?? TEXT_DEFAULT_PX) < SMALL_TEXT_PX
  )
  if (smallText.length) {
    issues.push({
      level: 'warn',
      message: 'Some text is under 10 px and will be hard to read in game.'
    })
  }

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    issues,
    size: [sheetWidth, sheetHeight],
    empty
  }
}
