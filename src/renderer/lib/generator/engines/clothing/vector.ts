/**
 * The four vector layer kinds, drawn with canvas 2D.
 *
 * RobloxKit splits its renderer in two: the nine pattern kinds go through a pure
 * pixel loop (`renderPixels`), and `text` / `image` / `shape` / `trim` go through
 * a canvas so the browser draws the glyphs, the beziers and the image scaling.
 * This module is the second half, ported 1:1 from the tail of `renderToCanvas`
 * (`render-CpljO1Hx.js`, `render:262-345`).
 *
 * Every draw runs inside `save() → beginPath() → rect(region) → clip()` so a
 * layer is hard-clipped to the face it targets. That clip is not defensive
 * coding: the atlas packs faces edge to edge, so without it a border on the
 * torso front would bleed into the torso right.
 *
 * Two upstream behaviours are reproduced deliberately and are surprising enough
 * to be worth naming:
 *
 *  - `opacity` is **ignored** on all four of these kinds — the pattern pass reads
 *    it, these branches never do (`render:135` vs `render:262-345`)
 *  - `x`/`y` are **unclamped** fractions, so `x: 3` places the artwork off-canvas
 *    rather than pinning it to the edge
 */

import type { Region } from './layout'
import type { ClothingLayer } from './schema'
import { shapePath } from './shapes'

/** The canvas operations the four vector kinds need. */
export interface LayerTarget {
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  strokeText(text: string, x: number, y: number, maxWidth?: number): void
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void
  drawImage(image: CanvasImageSource, x: number, y: number): void
  fill(): void
  stroke(): void
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineJoin: CanvasLineJoin
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number
  ): void
  closePath(): void
}

/** The four kinds this module owns. */
export const VECTOR_KINDS = ['text', 'image', 'shape', 'trim'] as const

/** The CSS family each design `font` keyword maps to (`render:129-134`). */
export const FONT_FAMILIES: Record<string, string> = {
  sans: '"IBM Plex Sans Variable", system-ui, sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, Menlo, monospace',
  display: "Impact, 'Arial Black', system-ui, sans-serif"
}

/** Resolves an image-layer `src` to something `drawImage` accepts. */
export type ImageLoader = (src: string) => Promise<CanvasImageSource>

const TEXT_MIN_PX = 6
const TEXT_DEFAULT_PX = 32
const TEXT_DEFAULT_WEIGHT = 700
const TEXT_LINE_HEIGHT = 1.1
/** Long text is condensed to this fraction of the region width, never wrapped. */
const TEXT_MAX_WIDTH = 0.96
const TEXT_OUTLINE_MIN = 2
const TEXT_OUTLINE_RATIO = 10

const SHAPE_DEFAULT_FRACTION = 0.4
const SHAPE_DEFAULT_OUTLINE = 2

const TRIM_DEFAULT_WIDTH = 6

/** The unclamped `x`/`y` accessor; upstream defaults it to the region centre. */
function at(value: unknown): number {
  return Number(value ?? 0.5)
}

function drawText(ctx: LayerTarget, region: Region, layer: ClothingLayer): void {
  const text = String(layer.text ?? '')
  if (!text) return

  const size = Math.max(TEXT_MIN_PX, Number(layer.size ?? TEXT_DEFAULT_PX))
  const family = FONT_FAMILIES[String(layer.font ?? 'sans')] ?? FONT_FAMILIES.sans
  ctx.font = `${layer.weight ?? TEXT_DEFAULT_WEIGHT} ${size}px ${family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lines = text.split('\n')
  const lineHeight = size * TEXT_LINE_HEIGHT
  const x = region.x + region.w * at(layer.x) + Number(layer.offsetX ?? 0)
  const y = region.y + region.h * at(layer.y) + Number(layer.offsetY ?? 0)
  const maxWidth = region.w * TEXT_MAX_WIDTH

  lines.forEach((line, index) => {
    const lineY = y + (index - (lines.length - 1) / 2) * lineHeight
    if (layer.outline) {
      ctx.lineWidth = Math.max(TEXT_OUTLINE_MIN, size / TEXT_OUTLINE_RATIO)
      ctx.lineJoin = 'round'
      ctx.strokeStyle = layer.outline
      ctx.strokeText(line, x, lineY, maxWidth)
    }
    ctx.fillStyle = layer.color ?? '#ffffff'
    ctx.fillText(line, x, lineY, maxWidth)
  })
}

/** An image layer's `src` already resolved to a drawable. */
interface Picture {
  source: CanvasImageSource
  width: number
  height: number
}

function drawPicture(
  ctx: LayerTarget,
  region: Region,
  layer: ClothingLayer,
  picture: Picture
): void {
  let width: number
  let height: number

  if (layer.w) {
    width = region.w * Number(layer.w)
    height = (picture.height / picture.width) * width
  } else {
    // No `w`: contain by default, cover when asked, then scaled.
    const fit = layer.fit === 'cover' ? Math.max : Math.min
    const scale =
      fit(region.w / picture.width, region.h / picture.height) * Number(layer.scale ?? 1)
    width = picture.width * scale
    height = picture.height * scale
  }

  const x = region.x + region.w * at(layer.x) + Number(layer.offsetX ?? 0)
  const y = region.y + region.h * at(layer.y) + Number(layer.offsetY ?? 0)
  ctx.drawImage(picture.source, x - width / 2, y - height / 2, width, height)
}

function drawShape(ctx: LayerTarget, region: Region, layer: ClothingLayer): void {
  const fraction = layer.w ?? layer.h ?? SHAPE_DEFAULT_FRACTION
  const width = region.w * Number(fraction)

  // Upstream's aspect rule, reproduced exactly: with an explicit `h` the height
  // is a plain fraction of the region height (so `w` and `h` are fractions of
  // *different* axes, a genuine quirk); without one, the height is corrected so
  // a shape with only `w` stays circular in pixels.
  const height = layer.h
    ? region.h * Number(layer.h)
    : region.h * Number(fraction) * (region.w / region.h)

  const cx = region.x + region.w * at(layer.x)
  const cy = region.y + region.h * at(layer.y)
  shapePath(ctx, String(layer.shape ?? 'circle'), cx, cy, width, height)

  ctx.fillStyle = layer.color ?? '#ffffff'
  ctx.fill()

  if (layer.outline) {
    ctx.lineWidth = Number(layer.outlineWidth ?? SHAPE_DEFAULT_OUTLINE)
    ctx.strokeStyle = layer.outline
    ctx.stroke()
  }
}

/** Which edges a trim paints, in the order upstream fills them. */
function trimEdges(edge: string | undefined): string[] {
  if (edge === 'all') return ['top', 'bottom', 'left', 'right']
  if (edge === 'sides') return ['left', 'right']
  return [edge ?? 'bottom']
}

function drawTrim(ctx: LayerTarget, region: Region, layer: ClothingLayer): void {
  // Pixels, not a fraction: 8 on a 64px limb face is 12.5% of the face.
  const width = Math.max(1, Number(layer.width ?? TRIM_DEFAULT_WIDTH))
  ctx.fillStyle = layer.color ?? '#ffffff'

  for (const edge of trimEdges(layer.edge)) {
    if (edge === 'top') ctx.fillRect(region.x, region.y, region.w, width)
    if (edge === 'bottom') ctx.fillRect(region.x, region.y + region.h - width, region.w, width)
    if (edge === 'left') ctx.fillRect(region.x, region.y, width, region.h)
    if (edge === 'right') ctx.fillRect(region.x + region.w - width, region.y, width, region.h)
  }
}

/** Whether a kind is drawn by this module rather than by the pixel loop. */
export function isVectorKind(kind: string): boolean {
  return (VECTOR_KINDS as readonly string[]).includes(kind)
}

/**
 * Draw one vector layer across every region it targets, clipped per region.
 *
 * `loadImage` is awaited once for an `image` layer, before the region loop, so a
 * picture is fetched at most once per layer rather than once per face.
 */
export async function drawVectorLayer(
  ctx: LayerTarget,
  regions: Region[],
  layer: ClothingLayer,
  loadImage: ImageLoader
): Promise<void> {
  let picture: Picture | undefined
  if (layer.kind === 'image' && layer.src) {
    const source = await loadImage(layer.src)
    const sized = source as CanvasImageSource & { width: number; height: number }
    picture = { source, width: sized.width, height: sized.height }
  }

  for (const region of regions) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(region.x, region.y, region.w, region.h)
    ctx.clip()

    if (layer.kind === 'text') drawText(ctx, region, layer)
    if (layer.kind === 'trim') drawTrim(ctx, region, layer)
    if (layer.kind === 'shape') drawShape(ctx, region, layer)
    if (picture) drawPicture(ctx, region, layer, picture)

    ctx.restore()
  }
}
