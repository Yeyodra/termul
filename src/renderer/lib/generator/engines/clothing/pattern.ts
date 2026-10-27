/**
 * The pattern field: given a layer and a region's dimensions, return a per-pixel
 * colour function.
 *
 * Ported from `render-CpljO1Hx.js:37-130`. Two properties decide whether a
 * reimplementation matches:
 *
 *  - coordinates are **region-local**, so every region restarts the pattern at
 *    its own top-left corner (`render:139`) — a real visual seam, and intended
 *  - `checks`, `plaid`, `polka` and `zigzag` read `angle` but never use it
 */

/** An RGB triple, 0-255 per channel. */
export type Rgb = [number, number, number]

/** Parse `#rgb` or `#rrggbb`; anything else collapses to black, as the original does. */
export function parseColor(value: unknown): Rgb {
  const text = String(value).replace('#', '')
  const hex = text.length === 3 ? text.replace(/./g, '$&$&') : text
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `out[k] = round(A[k] + (B[k] - A[k]) * t)` — half-up, matching the original. */
export function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]
}

/** mulberry32 (`render:4-13`). The first output seeds every noise cell. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 1831565813) >>> 0
    let e = t
    e = Math.imul(e ^ (e >>> 15), e | 1)
    e ^= e + Math.imul(e ^ (e >>> 7), e | 61)
    return ((e ^ (e >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (t: number): number => t * t * (3 - t * 2)

/**
 * Value noise on a memoised lattice (`render:14-35`).
 *
 * The per-cell value is the first output of `mulberry32(seed ^ hash)`, and the
 * memo is per-call, so the same `(ix, iy)` always yields the same value for a
 * given seed.
 */
export function valueNoise(seed: number, featureSize: number): (x: number, y: number) => number {
  const cache = new Map<number, number>()

  const cellValue = (ix: number, iy: number): number => {
    const hash = (ix * 73856093) ^ (iy * 19349663)
    const cached = cache.get(hash)
    if (cached !== undefined) return cached
    const value = mulberry32(seed ^ hash)()
    cache.set(hash, value)
    return value
  }

  return (x: number, y: number) => {
    const u = x / featureSize
    const v = y / featureSize
    const ix = Math.floor(u)
    const iy = Math.floor(v)
    const fx = smoothstep(u - ix)
    const fy = smoothstep(v - iy)

    const top = cellValue(ix, iy) * (1 - fx) + cellValue(ix + 1, iy) * fx
    const bottom = cellValue(ix, iy + 1) * (1 - fx) + cellValue(ix + 1, iy + 1) * fx
    return top * (1 - fy) + bottom * fy
  }
}

/** The subset of a layer the pattern field reads. */
export interface PatternLayer {
  kind: string
  color?: string | null
  color2?: string | null
  color3?: string | null
  from?: string | null
  to?: string | null
  size?: number | null
  gap?: number | null
  angle?: number | null
  seed?: number | null
}

/**
 * Build the per-pixel colour function for one layer on one region.
 *
 * `width`/`height` are the **region's** dimensions, not the sheet's.
 */
export function patternField(
  layer: PatternLayer,
  width: number,
  height: number
): (x: number, y: number) => Rgb {
  const primary = parseColor(layer.color ?? layer.from ?? '#ffffff')
  const secondary = parseColor(layer.color2 ?? layer.to ?? '#000000')
  const size = Math.max(2, Number(layer.size ?? 16))
  const gap = Math.max(1, Number(layer.gap ?? size))
  const radians = ((Number(layer.angle ?? 0) % 360) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const seed = Number(layer.seed ?? 7)

  switch (layer.kind) {
    case 'gradient': {
      const denom = Math.abs(width * cos) + Math.abs(height * sin) || 1
      return (x, y) => {
        const t = ((x - width / 2) * cos + (y - height / 2) * sin) / denom + 0.5
        return lerpColor(primary, secondary, Math.min(1, Math.max(0, t)))
      }
    }

    case 'stripes': {
      const period = size + gap
      return (x, y) => {
        const u = (((x * cos + y * sin) % period) + period) % period
        return u < size ? primary : secondary
      }
    }

    case 'checks':
      return (x, y) =>
        (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? primary : secondary

    case 'plaid': {
      const third = parseColor(layer.color3 ?? '#000000')
      const period = size + gap
      const halfBand = size / 2
      const pinWidth = Math.max(1, Math.round(size / 12))
      const pinCentre = period - gap / 2
      return (x, y) => {
        const px = ((x % period) + period) % period
        const py = ((y % period) + period) % period
        const mix = (Number(px < halfBand) + Number(py < halfBand)) / 2
        let out = lerpColor(primary, secondary, mix)

        if ((x + y) % 2 === 0 && mix === 0.5) {
          out = lerpColor(out, px < halfBand ? secondary : primary, 0.25)
        }
        if (
          Math.abs(px - pinCentre) < pinWidth / 2 + 0.25 ||
          Math.abs(py - pinCentre) < pinWidth / 2 + 0.25
        ) {
          return lerpColor(out, third, 0.65)
        }
        return out
      }
    }

    case 'polka': {
      const radius = size / 2
      const pitch = size + gap
      return (x, y) => {
        const shift = Math.floor(y / pitch) % 2 ? pitch / 2 : 0
        const dx = ((((x + shift) % pitch) + pitch) % pitch) - pitch / 2
        const dy = (((y % pitch) + pitch) % pitch) - pitch / 2
        return dx * dx + dy * dy <= radius * radius ? primary : secondary
      }
    }

    case 'zigzag': {
      const amplitude = size / 2
      const wavelength = Math.max(4, size * 2)
      const period = size + gap
      return (x, y) => {
        const px = ((x % wavelength) + wavelength) % wavelength
        const tri = px < wavelength / 2 ? px : wavelength - px
        const shifted = y - (tri / (wavelength / 2)) * amplitude
        const u = ((shifted % period) + period) % period
        return u < size ? primary : secondary
      }
    }

    case 'camo': {
      const coarse = valueNoise(seed, size * 2)
      const fine = valueNoise(seed + 1, size)
      const third = parseColor(layer.color3 ?? '#5a5a3c')
      return (x, y) => {
        const value = coarse(x, y) * 0.7 + fine(x, y) * 0.3
        if (value < 0.4) return primary
        if (value < 0.62) return secondary
        return third
      }
    }

    case 'noise': {
      const field = valueNoise(seed, size)
      return (x, y) => lerpColor(primary, secondary, field(x, y))
    }

    default:
      return () => primary
  }
}
