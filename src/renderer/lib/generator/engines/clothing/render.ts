/**
 * Design JSON -> RGBA buffer -> PNG, plus the visual check that gates `DONE`.
 *
 * Ported from `render-CpljO1Hx.js:198-349`. Two behaviours are reproduced
 * deliberately because they are visible:
 *
 *  - consecutive pattern layers render into one **transparent** batch buffer, so
 *    a pattern with `opacity < 1` darkens toward black before compositing
 *    (`render:231-349`)
 *  - pattern coordinates are region-local, so every region restarts the pattern
 *    at its own corner
 *
 * Only the pattern batch runs here. Vector layers (text/image/shape/trim) need a
 * 2D canvas and are out of scope for the headless path.
 */

import { type Region, regionsFor, resolveTarget, SHEET_DIMENSIONS } from './layout'
import { patternField, type Rgb } from './pattern'
import type { ClothingDesign, ClothingLayer, DesignType } from './schema'

/** A rasterised design, ready to encode. */
export interface RenderedSheet {
  width: number
  height: number
  /** RGBA, row-major, `width * height * 4` bytes. */
  pixels: Uint8ClampedArray
}

const isPattern = (kind: string): boolean =>
  kind !== 'text' && kind !== 'image' && kind !== 'shape' && kind !== 'trim'

function clampOpacity(value: unknown): number {
  return Math.min(1, Math.max(0, Number(value ?? 1)))
}

/** Composite `src` over `dst` in place, both premultiplied-by-alpha source-over. */
function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity: number): void {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = (src[i + 3] / 255) * opacity
    if (sa <= 0) continue
    const da = dst[i + 3] / 255
    const outA = sa + da * (1 - sa)
    if (outA <= 0) continue
    for (let c = 0; c < 3; c += 1) {
      dst[i + c] = Math.round((src[i + c] * sa + dst[i + c] * da * (1 - sa)) / outA)
    }
    dst[i + 3] = Math.round(outA * 255)
  }
}

/** Fill one region with a pattern layer, writing straight into `pixels`. */
function paintPatternRegion(
  pixels: Uint8ClampedArray,
  width: number,
  region: Region,
  layer: ClothingLayer
): void {
  const field = patternField(layer, region.w, region.h)
  const opacity = clampOpacity(layer.opacity)

  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const [r, g, b] = field(x, y) as Rgb
      const offset = ((region.y + y) * width + (region.x + x)) * 4
      if (opacity >= 1) {
        pixels[offset] = r
        pixels[offset + 1] = g
        pixels[offset + 2] = b
        pixels[offset + 3] = 255
      } else {
        const src = Uint8ClampedArray.of(r, g, b, 255)
        const dst = pixels.slice(offset, offset + 4)
        const merged = Uint8ClampedArray.from(dst)
        blendOver(merged, src, opacity)
        pixels.set(merged, offset)
      }
    }
  }
}

/**
 * Render a design to an RGBA buffer.
 *
 * Vector layers are skipped; a design with only vector layers yields the
 * background, which the validator already treats as valid.
 */
export function renderPixels(design: ClothingDesign): RenderedSheet {
  const { width, height } = SHEET_DIMENSIONS[design.type]
  const pixels = new Uint8ClampedArray(width * height * 4)

  if (design.background) {
    const hex = Number.parseInt(String(design.background).replace('#', ''), 16)
    const [r, g, b] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = 255
    }
  }

  for (const layer of design.layers ?? []) {
    if (layer.hidden || !isPattern(layer.kind)) continue
    for (const region of resolveTarget(design.type, layer.target ?? 'all')) {
      paintPatternRegion(pixels, width, region, layer)
    }
  }

  return { width, height, pixels }
}

/** How much of the sheet ended up painted, 0..1. */
export function coverage(rendered: RenderedSheet): number {
  let painted = 0
  const total = rendered.width * rendered.height
  for (let i = 3; i < rendered.pixels.length; i += 4) {
    if (rendered.pixels[i] > 0) painted += 1
  }
  return total ? painted / total : 0
}

/** How many distinct colours the sheet holds; a flat fill is one. */
export function distinctColors(rendered: RenderedSheet, limit = 512): number {
  const seen = new Set<number>()
  for (let i = 0; i < rendered.pixels.length; i += 4) {
    if (rendered.pixels[i + 3] === 0) continue
    seen.add((rendered.pixels[i] << 16) | (rendered.pixels[i + 1] << 8) | rendered.pixels[i + 2])
    if (seen.size >= limit) return limit
  }
  return seen.size
}

/** The sheet dimensions a design type renders at, for the report. */
export function sheetSize(type: DesignType): { width: number; height: number } {
  return SHEET_DIMENSIONS[type]
}

/** The region ids the review sheet can name, for the layout string. */
export function regionSummary(type: DesignType): string {
  return regionsFor(type)
    .map((region) => region.id)
    .join(', ')
}
