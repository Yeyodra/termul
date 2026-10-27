/**
 * The clothing engine: validator wording, pattern math, and determinism.
 *
 * The validator strings are echoed to the model verbatim, and the renderer must
 * be reproducible from the spec alone, so both are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { buildClothing, DesignRejected } from '@/lib/generator/engines/clothing/build'
import {
  regionsFor,
  resolveTarget,
  SHEET_DIMENSIONS
} from '@/lib/generator/engines/clothing/layout'
import {
  lerpColor,
  mulberry32,
  parseColor,
  patternField,
  valueNoise
} from '@/lib/generator/engines/clothing/pattern'
import { coverage, distinctColors, renderPixels } from '@/lib/generator/engines/clothing/render'
import {
  type ClothingDesign,
  type ClothingLayer,
  LAYER_KINDS,
  targetResolves,
  validateDesign
} from '@/lib/generator/engines/clothing/schema'

const solid = (overrides: Partial<ClothingLayer> = {}): ClothingLayer => ({
  kind: 'solid',
  color: '#ff0000',
  target: 'all',
  ...overrides
})

const trim = (overrides: Partial<ClothingLayer> = {}): ClothingLayer => ({
  kind: 'trim',
  color: '#ff0000',
  target: 'all',
  ...overrides
})

const design = (
  layers: ClothingLayer[],
  overrides: Partial<ClothingDesign> = {}
): ClothingDesign => ({
  type: 'shirt',
  layers,
  ...overrides
})

describe('parseColor', () => {
  it('reads #rrggbb', () => {
    expect(parseColor('#ff8000')).toEqual([255, 128, 0])
  })

  it('expands #rgb', () => {
    expect(parseColor('#f80')).toEqual([255, 136, 0])
  })

  it('collapses garbage to black, as the original does', () => {
    expect(parseColor('nope')).toEqual([0, 0, 0])
  })
})

describe('lerpColor', () => {
  it('rounds half up', () => {
    expect(lerpColor([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128])
  })

  it('returns the endpoints exactly', () => {
    expect(lerpColor([1, 2, 3], [9, 9, 9], 0)).toEqual([1, 2, 3])
    expect(lerpColor([1, 2, 3], [9, 9, 9], 1)).toEqual([9, 9, 9])
  })
})

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const first = [a(), a(), a()]
    const second = [b(), b(), b()]
    expect(first).toEqual(second)
  })

  it('differs between seeds', () => {
    expect(mulberry32(7)()).not.toBe(mulberry32(8)())
  })

  it('stays inside [0, 1)', () => {
    const next = mulberry32(123)
    for (let i = 0; i < 200; i += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('valueNoise', () => {
  it('is deterministic for a seed and feature size', () => {
    const a = valueNoise(7, 16)
    const b = valueNoise(7, 16)
    expect(a(3.5, 9.25)).toBe(b(3.5, 9.25))
  })

  it('stays inside [0, 1)', () => {
    const field = valueNoise(7, 16)
    for (let x = 0; x < 20; x += 3) {
      for (let y = 0; y < 20; y += 3) {
        const value = field(x, y)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    }
  })
})

describe('patternField', () => {
  it('solid is constant', () => {
    const field = patternField({ kind: 'solid', color: '#123456' }, 10, 10)
    expect(field(0, 0)).toEqual([18, 52, 86])
    expect(field(9, 9)).toEqual([18, 52, 86])
  })

  it('falls back from color to from', () => {
    const field = patternField({ kind: 'solid', from: '#00ff00' }, 4, 4)
    expect(field(0, 0)).toEqual([0, 255, 0])
  })

  it('gradient spans the region exactly', () => {
    const field = patternField(
      { kind: 'gradient', color: '#000000', color2: '#ffffff', angle: 0 },
      100,
      10
    )
    expect(field(0, 0)[0]).toBe(0)
    expect(field(49, 0)[0]).toBeGreaterThan(100)
    expect(field(99, 0)[0]).toBeGreaterThan(240)
  })

  it('stripes alternate with size + gap period', () => {
    const field = patternField(
      { kind: 'stripes', color: '#ffffff', color2: '#000000', size: 4, gap: 4, angle: 0 },
      20,
      1
    )
    expect(field(0, 0)).toEqual([255, 255, 255])
    expect(field(5, 0)).toEqual([0, 0, 0])
    expect(field(8, 0)).toEqual([255, 255, 255])
  })

  it('checks uses size as the cell', () => {
    const field = patternField(
      { kind: 'checks', color: '#ffffff', color2: '#000000', size: 4 },
      20,
      20
    )
    expect(field(0, 0)).toEqual([255, 255, 255])
    expect(field(5, 0)).toEqual([0, 0, 0])
    expect(field(5, 5)).toEqual([255, 255, 255])
  })

  it('polka staggers odd rows so the lattice is offset', () => {
    const field = patternField(
      { kind: 'polka', color: '#ffffff', color2: '#000000', size: 8, gap: 8 },
      64,
      64
    )
    const firstRow = Array.from({ length: 16 }, (_, x) => field(x, 0).join(','))
    const secondRow = Array.from({ length: 16 }, (_, x) => field(x, 8).join(','))
    expect(firstRow).not.toEqual(secondRow)
  })

  it('noise is deterministic for a seed', () => {
    const a = patternField(
      { kind: 'noise', color: '#000000', color2: '#ffffff', size: 8, seed: 3 },
      32,
      32
    )
    const b = patternField(
      { kind: 'noise', color: '#000000', color2: '#ffffff', size: 8, seed: 3 },
      32,
      32
    )
    expect(a(5, 5)).toEqual(b(5, 5))
  })

  it('camo thresholds into three colours', () => {
    const field = patternField(
      { kind: 'camo', color: '#000000', color2: '#888888', color3: '#ffffff', size: 16, seed: 7 },
      64,
      64
    )
    const seen = new Set(field(3, 3).join(','))
    for (let x = 0; x < 64; x += 7) {
      for (let y = 0; y < 64; y += 7) {
        seen.add(field(x, y).join(','))
      }
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('layout', () => {
  it('gives a shirt 18 regions and a tshirt one', () => {
    expect(regionsFor('shirt')).toHaveLength(18)
    expect(regionsFor('pants')).toHaveLength(18)
    expect(regionsFor('tshirt')).toHaveLength(1)
  })

  it('resolves "torso" as a part, covering six regions', () => {
    expect(resolveTarget('shirt', 'torso')).toHaveLength(6)
  })

  it('resolves "left" as a face, covering three regions', () => {
    expect(resolveTarget('shirt', 'left')).toHaveLength(3)
  })

  it('resolves an exact region id to one region', () => {
    expect(resolveTarget('shirt', 'torso_front')).toEqual([
      { id: 'torso_front', part: 'torso', face: 'front', x: 231, y: 74, w: 128, h: 128 }
    ])
  })

  it('resolves "all" to every region', () => {
    expect(resolveTarget('shirt', 'all')).toHaveLength(18)
  })

  it('uses the documented sheet dimensions', () => {
    expect(SHEET_DIMENSIONS.shirt).toEqual({ width: 585, height: 559 })
    expect(SHEET_DIMENSIONS.tshirt).toEqual({ width: 512, height: 512 })
  })
})

describe('validateDesign', () => {
  it('accepts a minimal valid design', () => {
    expect(validateDesign(design([solid()]))).toEqual([])
  })

  it('rejects a non-object immediately', () => {
    expect(validateDesign(null)).toEqual(['the design is not an object'])
  })

  it('reports an unknown type', () => {
    expect(validateDesign({ type: 'dress', layers: [solid()] })).toContain(
      'type: must be one of shirt, pants, tshirt'
    )
  })

  it('reports a bad background', () => {
    expect(validateDesign(design([solid()], { background: 'red' }))).toContain(
      'background: must be #rrggbb or null'
    )
  })

  it('requires at least one layer', () => {
    expect(validateDesign({ type: 'shirt', layers: [] })).toContain(
      'layers: needs at least one layer'
    )
  })

  it('caps the layer count at 40', () => {
    const many = Array.from({ length: 41 }, () => solid())
    expect(validateDesign(design(many))).toContain('layers: at most 40')
  })

  it('reports an unknown kind and stops checking that layer', () => {
    const problems = validateDesign(design([{ kind: 'nope', color: 'bad' }]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('layers[0].kind: "nope" is not one of solid, gradient')
  })

  it('reports a colour that is not #rrggbb', () => {
    expect(validateDesign(design([solid({ color: '#xyz' })]))).toContain(
      'layers[0].color: "#xyz" is not a #rrggbb colour'
    )
  })

  it('reports a unit value out of range', () => {
    expect(validateDesign(design([solid({ opacity: 2 })]))).toContain(
      'layers[0].opacity: must be a number from 0 to 1'
    )
  })

  it('reports size, gap and angle ranges', () => {
    expect(validateDesign(design([solid({ size: 0 })]))).toContain(
      'layers[0].size: must be a number from 1 to 400'
    )
    expect(validateDesign(design([solid({ gap: 500 })]))).toContain(
      'layers[0].gap: must be a number from 0 to 400'
    )
    expect(validateDesign(design([solid({ angle: 400 })]))).toContain(
      'layers[0].angle: must be a number from -360 to 360'
    )
  })

  it('reports a target that names no region of the garment', () => {
    expect(validateDesign(design([solid({ target: 'right_leg' })]))).toContain(
      'layers[0].target: "right_leg" names no region of a shirt; use all, a part (torso, right_arm, left_arm), a side (front, back, left, right, up, down) or a region id'
    )
  })

  it('accepts a leg target on pants', () => {
    expect(validateDesign({ type: 'pants', layers: [solid({ target: 'right_leg' })] })).toEqual([])
  })

  it('reports text length and font', () => {
    const problems = validateDesign(design([{ kind: 'text', text: 'x'.repeat(61), font: 'comic' }]))
    expect(problems).toContain('layers[0].text: 1 to 60 characters')
    expect(problems).toContain('layers[0].font: one of sans, serif, mono, display')
  })

  it('reports an unknown shape and edge', () => {
    expect(validateDesign(design([{ kind: 'shape', shape: 'blob' }]))).toContain(
      'layers[0].shape: one of rect, circle, star, heart, diamond, triangle'
    )
    expect(validateDesign(design([{ kind: 'trim', edge: 'diagonal' }]))).toContain(
      'layers[0].edge: one of top, bottom, left, right, sides, all'
    )
  })

  it('reports an image layer with no picture attached', () => {
    expect(validateDesign(design([{ kind: 'image' }]))).toContain(
      'layers[0]: an image layer needs "image": the number of an attached picture (0)'
    )
  })

  it('reports an out-of-range image index when pictures exist', () => {
    expect(validateDesign(design([{ kind: 'image', image: 2 }]), { images: 2 })).toContain(
      'layers[0].image: must be 0..1'
    )
  })

  it('accumulates every problem rather than stopping at the first', () => {
    const problems = validateDesign(design([solid({ color: 'bad' }), solid({ color: 'alsobad' })]))
    expect(problems.length).toBeGreaterThanOrEqual(2)
  })

  it('covers every kind in LAYER_KINDS without rejecting the kind itself', () => {
    for (const kind of LAYER_KINDS) {
      const problems = validateDesign(design([{ kind, target: 'all' }]))
      expect(problems.some((problem) => problem.includes('is not one of'))).toBe(false)
    }
  })
})

describe('targetResolves', () => {
  it('accepts all, parts, sides and region ids', () => {
    expect(targetResolves('shirt', 'all')).toBe(true)
    expect(targetResolves('shirt', 'torso')).toBe(true)
    expect(targetResolves('shirt', 'front')).toBe(true)
    expect(targetResolves('shirt', 'torso_front')).toBe(true)
  })

  it('rejects a part the garment does not have', () => {
    expect(targetResolves('shirt', 'right_leg')).toBe(false)
    expect(targetResolves('pants', 'left_arm')).toBe(false)
  })
})

describe('renderPixels', () => {
  it('renders at the type dimensions', () => {
    const out = renderPixels(design([solid()]))
    expect(out.width).toBe(585)
    expect(out.height).toBe(559)
    expect(out.pixels).toHaveLength(585 * 559 * 4)
  })

  it('keeps the background on the sheet margin outside every region', () => {
    const out = renderPixels(design([solid({ color: '#00ff00' })], { background: '#0000ff' }))
    const margin = Array.from(out.pixels.slice(0, 4))
    expect(margin).toEqual([0, 0, 255, 255])
  })

  it('paints the layer colour inside a region', () => {
    const out = renderPixels(design([solid({ color: '#00ff00', target: 'torso_front' })]))
    const offset = ((74 + 10) * 585 + (231 + 10)) * 4
    expect(Array.from(out.pixels.slice(offset, offset + 4))).toEqual([0, 255, 0, 255])
  })

  it('leaves unpainted areas transparent', () => {
    const out = renderPixels(design([solid({ target: 'torso_front' })]))
    expect(coverage(out)).toBeLessThan(1)
    expect(out.pixels[3]).toBe(0)
  })

  it('skips a hidden layer entirely', () => {
    const out = renderPixels(design([solid({ hidden: true })]))
    expect(coverage(out)).toBe(0)
  })

  it('renders a solid design as one distinct colour', () => {
    const out = renderPixels(design([solid({ color: '#123456' })]))
    expect(distinctColors(out)).toBe(1)
  })

  // Two full 585x559 noise passes. That is ~650k value-noise evaluations, which
  // clears the default 15s budget only when the suite runs unloaded, so the
  // budget is raised here rather than left to chance.
  it('is reproducible from the spec alone', { timeout: 60_000 }, () => {
    const spec = design([
      solid({ kind: 'noise', color: '#000000', color2: '#ffffff', size: 8, seed: 11 })
    ])
    const a = renderPixels(spec)
    const b = renderPixels(spec)
    expect(a.pixels).toEqual(b.pixels)
  })

  it('changes when the seed changes', () => {
    const base: ClothingLayer = {
      kind: 'noise',
      color: '#000000',
      color2: '#ffffff',
      size: 8,
      target: 'all'
    }
    const a = renderPixels(design([{ ...base, seed: 1 }]))
    const b = renderPixels(design([{ ...base, seed: 2 }]))
    expect(a.pixels).not.toEqual(b.pixels)
  })
})

describe('buildClothing', () => {
  it('returns a report with the sheet dimensions', async () => {
    const built = await buildClothing(design([solid()]), { type: 'shirt' })

    expect(built.report.ok).toBe(true)
    expect(built.report.width).toBe(585)
    expect(built.report.height).toBe(559)
    expect(built.report.size).toEqual([585, 559])
  })

  it('forces the garment type from the tool call, not the model', async () => {
    const built = await buildClothing({ type: 'pants', layers: [solid()] }, { type: 'tshirt' })
    expect((built.spec as ClothingDesign).type).toBe('tshirt')
    expect(built.report.width).toBe(512)
  })

  it('throws DesignRejected carrying the problems', async () => {
    let error: unknown
    try {
      await buildClothing(design([solid({ color: 'nope' })]), { type: 'shirt' })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(DesignRejected)
    expect((error as DesignRejected).problems).toContain(
      'layers[0].color: "nope" is not a #rrggbb colour'
    )
  })

  it('names the regions a solid fill leaves bare', async () => {
    const built = await buildClothing(design([solid({ target: 'torso' })]), { type: 'shirt' })

    const issues = built.report.issues as Array<{ level: string; message: string }>
    const empty = issues.find((issue) => issue.message.includes('left empty'))

    expect(empty?.level).toBe('warn')
    expect(empty?.message).toContain('right_arm')
    expect(built.report.ok).toBe(true)
  })

  it('does not report empty regions for a t-shirt', async () => {
    const built = await buildClothing(design([solid()]), { type: 'tshirt' })
    expect(built.report.empty).toEqual([])
  })

  it('lists every layer in the layout, bottom to top', async () => {
    const built = await buildClothing(
      design([solid(), solid({ color: '#ffffff', target: 'torso_up' })]),
      { type: 'shirt' }
    )

    expect(built.layout).toContain('Layers (bottom to top):')
    expect(built.layout).toContain('0. solid on all #ff0000')
    expect(built.layout).toContain('1. solid on torso_up #ffffff')
  })

  it('says every region is painted when the design covers the garment', async () => {
    const built = await buildClothing(design([solid()]), { type: 'shirt' })
    expect(built.layout).toContain('Every region is painted.')
  })

  it('draws a trim layer, which the pattern pass alone would drop', async () => {
    const built = await buildClothing(
      design([solid({ color: '#000000' }), trim({ color: '#ffffff', edge: 'all', width: 8 })]),
      { type: 'shirt' }
    )

    expect(built.sheet).toMatch(/^data:image\/png;base64,/)
    expect(built.layout).toContain('1. trim on all #ffffff')
  })
})
