/**
 * Design JSON -> canvas, and the two-pass compositor that draws every layer kind.
 *
 * Ported 1:1 from RobloxKit's `renderToCanvas` (`render-CpljO1Hx.js`,
 * `render:231-349`). The structure is the whole point:
 *
 *  1. `clearRect` the sheet (transparent)
 *  2. `fillRect` the `background`, if any, as an opaque hex string
 *  3. walk the layers bottom-to-top
 *     - `hidden` is skipped entirely
 *     - a **pattern** kind joins a pending batch
 *     - a **vector** kind flushes the batch first, then draws clipped per region
 *  4. flush whatever batch is left
 *
 * ## Why the batch exists, and the artifact it carries
 *
 * A run of consecutive pattern layers is rasterised as *one* buffer by
 * `renderPixels({...design, background: null, layers: batch})` — so it starts
 * from transparent black, not from the canvas' current contents — then
 * `putImageData` into a scratch canvas and `drawImage`d with `source-over`.
 *
 * The consequence is a real double-darkening: a 50% red pattern over white
 * yields roughly `(191,128,128)`, not `(255,128,128)`, because the pattern's own
 * `opacity` blends it toward transparent black inside the batch first.
 *
 * That is an upstream artifact, reproduced deliberately. If it is ever fixed,
 * fix it as a labelled divergence, not silently.
 *
 * The `renderPixels` half is still pure and deterministic, which is what the
 * pattern tests assert on; only the vector half needs a canvas.
 */

import { type Region, regionsFor, resolveTarget, SHEET_DIMENSIONS } from './layout'
import { patternField, type Rgb } from './pattern'
import type { ClothingDesign, ClothingLayer, DesignType } from './schema'
import { drawVectorLayer, type ImageLoader, isVectorKind, type LayerTarget } from './vector'

/** A rasterised design, ready to encode. */
export interface RenderedSheet {
  width: number
  height: number
  /** RGBA, row-major, `width * height * 4` bytes. */
  pixels: Uint8ClampedArray
}

/** The 2D context operations the compositor needs beyond drawing layers. */
export interface CompositorTarget extends LayerTarget {
  clearRect(x: number, y: number, w: number, h: number): void
  createImageData(width: number, height: number): ImageData
  putImageData(data: ImageData, x: number, y: number): void
  getImageData(x: number, y: number, w: number, h: number): ImageData
}

/** A canvas the compositor can draw into. */
export interface SheetCanvas {
  width: number
  height: number
  getContext(kind: '2d'): CompositorTarget | null
  toDataURL(type?: string): string
}

const isPattern = (kind: string): boolean => !isVectorKind(kind)

/**
 * Composite one pattern layer into `pixels` over `region`.
 *
 * Upstream's `opacity` handling, reproduced exactly (`render:135-151`): below 1
 * it lerps each channel toward the layer colour and takes `max(oldAlpha,
 * round(opacity*255))` — a **max**, not source-over accumulation, which is why
 * two half-opaque layers do not compound to 75%.
 */
function paintPatternRegion(
  pixels: Uint8ClampedArray,
  width: number,
  region: Region,
  layer: ClothingLayer
): void {
  const field = patternField(layer, region.w, region.h)
  const opacity = Math.min(1, Math.max(0, Number(layer.opacity ?? 1)))
  const alpha = Math.round(opacity * 255)

  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const [r, g, b] = field(x, y) as Rgb
      const offset = ((region.y + y) * width + (region.x + x)) * 4

      if (opacity >= 1) {
        pixels[offset] = r
        pixels[offset + 1] = g
        pixels[offset + 2] = b
        pixels[offset + 3] = 255
        continue
      }

      pixels[offset] = Math.round(pixels[offset] * (1 - opacity) + r * opacity)
      pixels[offset + 1] = Math.round(pixels[offset + 1] * (1 - opacity) + g * opacity)
      pixels[offset + 2] = Math.round(pixels[offset + 2] * (1 - opacity) + b * opacity)
      pixels[offset + 3] = Math.max(pixels[offset + 3], alpha)
    }
  }
}

/**
 * Render the pattern layers of `design` to an RGBA buffer.
 *
 * `background` is honoured, so this stays useful on its own; the compositor
 * calls it with `background: null` for each batch.
 */
export function renderPixels(design: ClothingDesign): RenderedSheet {
  const { width, height } = SHEET_DIMENSIONS[design.type]
  const pixels = new Uint8ClampedArray(width * height * 4)

  if (design.background) {
    const hex = Number.parseInt(String(design.background).replace('#', ''), 16)
    const r = (hex >> 16) & 255
    const g = (hex >> 8) & 255
    const b = hex & 255
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

// Per-flush, not shared: the scratch canvas is resized to the sheet, so two
// concurrent sheets would clobber each other's pixels.
function blit(ctx: CompositorTarget, sheet: RenderedSheet): void {
  const scratch = document.createElement('canvas')
  scratch.width = sheet.width
  scratch.height = sheet.height

  const scratchCtx = scratch.getContext('2d')
  if (!scratchCtx) throw new Error('a 2D canvas is unavailable, so a pattern batch cannot be drawn')

  const image = scratchCtx.createImageData(sheet.width, sheet.height)
  image.data.set(sheet.pixels)
  scratchCtx.putImageData(image, 0, 0)
  ctx.drawImage(scratch, 0, 0)
}

/**
 * Draw `design` into `canvas`, returning the same canvas.
 *
 * `loadImage` is only consulted for `image` layers. Pass a loader that throws
 * when pictures are unavailable so the failure surfaces instead of the layer
 * vanishing.
 *
 * `onLayer` fires after each visible layer reaches the canvas, with the 1-based
 * count and the total. RobloxKit shows "Drawing layer 5 of 7" and the sheet
 * growing behind it; without this hook the render is one opaque pass and the
 * page has nothing to show until it is already finished.
 *
 * The flush stays batched. A run of pattern layers is drawn in one pass, so the
 * hook reports the last layer of that run rather than every layer in it - which
 * is exactly the progress a user sees, and it keeps the output identical to the
 * un-instrumented render (D14: flush per layer, not per pattern).
 */
export async function renderToCanvas(
  design: ClothingDesign,
  canvas: SheetCanvas,
  loadImage: ImageLoader,
  onLayer?: (drawn: number, total: number) => void
): Promise<SheetCanvas> {
  const { width, height } = SHEET_DIMENSIONS[design.type]
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the sheet cannot be drawn')

  ctx.clearRect(0, 0, width, height)

  const visible = (design.layers ?? []).filter((layer) => !layer.hidden)
  const total = visible.length
  let drawn = 0

  let batch: ClothingLayer[] = []
  const flush = (): void => {
    if (!batch.length) return
    blit(ctx, renderPixels({ ...design, background: null, layers: batch }))
    batch = []
  }

  if (design.background) {
    ctx.fillStyle = design.background
    ctx.fillRect(0, 0, width, height)
  }

  for (const layer of visible) {
    drawn += 1

    if (isPattern(layer.kind)) {
      batch.push(layer)
      // A pattern only becomes visible once its batch is blitted, so report it
      // when the batch ends rather than here; the count still advances so the
      // node can show "layer 3 of 7" while the batch is open.
      onLayer?.(drawn, total)
      continue
    }

    // A vector layer must land above every pattern beneath it, so the pending
    // batch has to reach the canvas first.
    flush()
    await drawVectorLayer(ctx, resolveTarget(design.type, layer.target ?? 'all'), layer, loadImage)
    onLayer?.(drawn, total)
  }

  flush()
  return canvas
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
