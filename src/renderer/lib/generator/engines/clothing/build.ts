/**
 * The clothing engine behind `designLoop`.
 *
 * `build(design)` is the validator contract: it returns a `BuildResult` on
 * success and **throws** an error carrying `problems: string[]` when the design
 * is invalid. That throw is the whole self-correction mechanism — the loop
 * echoes those strings back to the model and re-asks.
 *
 * The render is async because an `image` layer draws from a picture that has to
 * be decoded first, exactly as RobloxKit's `renderToCanvas` awaits its `Image`.
 */

import type { BuildResult } from '../../types'
import { checkDesign } from './check'
import { SHEET_DIMENSIONS } from './layout'
import { pngDataUrl } from './png'
import { renderToCanvas, type SheetCanvas } from './render'
import { checkFacts, layerLayout } from './report'
import { type ClothingDesign, type DesignType, normalizeDesign, validateDesign } from './schema'
import type { ImageLoader } from './vector'

/** A design that failed validation, in the shape the loop expects. */
export class DesignRejected extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.name = 'DesignRejected'
    this.problems = problems
  }
}

/** A design whose pictures cannot be decoded. */
export class ImageUnavailable extends Error {
  readonly problems: string[]

  constructor(message: string) {
    super(message)
    this.name = 'ImageUnavailable'
    this.problems = [message]
  }
}

export interface ClothingBuildOptions {
  /** Decided by the tool call, never by the model. */
  type: DesignType
  /** Attached pictures, for image-layer index validation and `src` resolution. */
  images?: string[]
  /** Overrides the canvas, for tests. */
  canvas?: SheetCanvas
  /** Overrides image decoding, for tests. */
  loadImage?: ImageLoader
}

/** Decode a data URL through an `Image`, as upstream's cached loader does. */
function defaultImageLoader(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('could not read that image'))
    image.src = src
  })
}

/**
 * Resolve `image: n` into `src`, upstream's only design normalisation
 * (`design-PKArvEjc.js`, `function d`).
 */
function attachImages(design: ClothingDesign, images: string[]): ClothingDesign {
  return {
    ...design,
    layers: (design.layers ?? []).map((layer, index) => {
      const base = { id: layer.id ?? `l${index}`, target: 'all', ...layer }
      if (layer.kind === 'image' && layer.image != null && images[layer.image]) {
        return { ...base, src: images[layer.image] }
      }
      return base
    })
  }
}

/** A blank canvas of the requested size. */
function createCanvas(width: number, height: number): SheetCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * Validate, render, check, and describe the result.
 *
 * `report.ok` gates `DONE` acceptance, and `layout` is the per-layer inventory
 * the model reads when deciding whether to keep the design.
 */
export async function buildClothing(
  spec: unknown,
  { type, images = [], canvas, loadImage = defaultImageLoader }: ClothingBuildOptions
): Promise<BuildResult> {
  const normalized = attachImages(normalizeDesign(spec as ClothingDesign, type), images)

  const problems = validateDesign(normalized, { images: images.length })
  if (problems.length) throw new DesignRejected(problems)

  const size = SHEET_DIMENSIONS[type]
  const sheet = canvas ?? createCanvas(size.width, size.height)

  let drawn: SheetCanvas
  try {
    drawn = await renderToCanvas(normalized, sheet, loadImage)
  } catch (error) {
    throw new ImageUnavailable(error instanceof Error ? error.message : String(error))
  }

  const ctx = drawn.getContext('2d')
  if (!ctx) throw new Error('a 2D canvas is unavailable, so the sheet cannot be read back')

  const pixels = ctx.getImageData(0, 0, drawn.width, drawn.height).data
  const check = checkDesign(normalized, pixels, drawn.width, drawn.height)

  return {
    spec: normalized,
    sheet: pngDataUrl(drawn),
    report: {
      ok: check.ok,
      issues: check.issues,
      width: drawn.width,
      height: drawn.height,
      size: check.size,
      empty: check.empty
    },
    layout: layerLayout(normalized, check) + '\n' + checkFacts(check.issues)
  }
}
