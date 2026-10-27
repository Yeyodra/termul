/**
 * The six `shape` outlines, as canvas paths.
 *
 * Ported 1:1 from `shapePath` in RobloxKit's `render-CpljO1Hx.js`
 * (`function v`, `render:355-393`). The geometry is load-bearing, not
 * decorative: `star` is ten vertices alternating the full radius with 0.45 of
 * it, starting at -PI/2 and stepping PI/5, and `heart` is two symmetric cubic
 * beziers whose waist control points sit at +/-1.4*rx and -1.2*ry. Changing a
 * constant changes how a ported design looks.
 *
 * `circle` is the `default` branch, so an unrecognised shape string also draws
 * an ellipse. The validator rejects unknown shapes before we get here, so that
 * path is unreachable in practice — it is reproduced anyway so this stays a
 * faithful port rather than a corrected one.
 */

/** The subset of the 2D context `shapePath` needs. */
export interface PathTarget {
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
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

/** Ten vertices, so a star has five points. */
const STAR_VERTICES = 10
/** Inner radius as a fraction of the outer one. */
const STAR_INNER = 0.45

/**
 * Lay `shape` into `ctx`'s path, centred on `(cx, cy)` with full `width`/`height`.
 *
 * Callers pass the **already resolved** pixel size; the region-fraction maths
 * lives in `vector.ts` because it differs per kind.
 */
export function shapePath(
  ctx: PathTarget,
  shape: string,
  cx: number,
  cy: number,
  width: number,
  height: number
): void {
  ctx.beginPath()
  const rx = width / 2
  const ry = height / 2

  switch (shape) {
    case 'rect':
      ctx.rect(cx - rx, cy - ry, width, height)
      break

    case 'diamond':
      ctx.moveTo(cx, cy - ry)
      ctx.lineTo(cx + rx, cy)
      ctx.lineTo(cx, cy + ry)
      ctx.lineTo(cx - rx, cy)
      ctx.closePath()
      break

    case 'triangle':
      ctx.moveTo(cx, cy - ry)
      ctx.lineTo(cx + rx, cy + ry)
      ctx.lineTo(cx - rx, cy + ry)
      ctx.closePath()
      break

    case 'star':
      // The first `lineTo` on a fresh path behaves as `moveTo`, as upstream relies on.
      for (let vertex = 0; vertex < STAR_VERTICES; vertex += 1) {
        const angle = -Math.PI / 2 + (vertex * Math.PI) / 5
        const radius = vertex % 2 ? STAR_INNER : 1
        ctx.lineTo(cx + Math.cos(angle) * rx * radius, cy + Math.sin(angle) * ry * radius)
      }
      ctx.closePath()
      break

    case 'heart':
      ctx.moveTo(cx, cy + ry)
      ctx.bezierCurveTo(cx - rx * 1.4, cy, cx - rx * 0.6, cy - ry * 1.2, cx, cy - ry * 0.4)
      ctx.bezierCurveTo(cx + rx * 0.6, cy - ry * 1.2, cx + rx * 1.4, cy, cx, cy + ry)
      ctx.closePath()
      break

    default:
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  }
}
