/**
 * End to end through the real engine, with no mocks of the render.
 *
 * The other page tests stub `runPageGeneration`, which proves the wiring but not
 * that a generation actually produces a record. This one runs `buildClothing` on
 * a real canvas in jsdom, checks the layer progress the page listens to, and
 * checks the record the host would write. It is the test that would fail if the
 * streaming hook stopped firing or the atlas stopped being produced.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildClothing } from '@/lib/generator/engines/clothing/build'
import { SHEET_DIMENSIONS } from '@/lib/generator/engines/clothing/layout'
import type { ClothingLayer } from '@/lib/generator/engines/clothing/schema'
import { paintedByRegion, paintReport } from '@/lib/roblox-inspector'

const layer = (overrides: Partial<ClothingLayer> = {}): ClothingLayer => ({
  kind: 'solid',
  color: '#ff0000',
  target: 'all',
  ...overrides
})

/** A design whose layers are all non-pattern, so each one draws on its own. */
function visibleLayers(count: number): ClothingLayer[] {
  return Array.from({ length: count }, (_, index) =>
    layer({
      kind: 'solid',
      color: index % 2 === 0 ? '#c02020' : '#2020c0',
      target: 'torso_front'
    })
  )
}

describe('a page generation, end to end', () => {
  it('reports every visible layer as it reaches the sheet', async () => {
    const seen: Array<[number, number]> = []
    await buildClothing(
      { type: 'shirt', layers: visibleLayers(5) },
      { type: 'shirt', avatarSheet: false, onLayer: (drawn, total) => seen.push([drawn, total]) }
    )

    expect(seen).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5]
    ])
  })

  it('does not count a hidden layer in the total', async () => {
    const seen: Array<[number, number]> = []
    await buildClothing(
      {
        type: 'shirt',
        layers: [...visibleLayers(3), layer({ hidden: true }), layer({ hidden: true })]
      },
      { type: 'shirt', avatarSheet: false, onLayer: (drawn, total) => seen.push([drawn, total]) }
    )

    expect(seen.at(-1)).toEqual([3, 3])
  })

  it('produces the atlas and the review sheet a page needs to save', async () => {
    const built = await buildClothing(
      { type: 'shirt', layers: visibleLayers(3) },
      { type: 'shirt' }
    )

    expect(built.template).toMatch(/^data:image\/png;base64,/)
    expect(built.sheet).toMatch(/^data:image\/png;base64,/)
    expect(built.report.ok).toBe(true)
    expect(built.report.width).toBe(SHEET_DIMENSIONS.shirt.width)
    expect(built.report.height).toBe(SHEET_DIMENSIONS.shirt.height)
  })

  it('keeps the render byte-identical whether or not progress is watched', async () => {
    const spec = { type: 'shirt' as const, layers: visibleLayers(4) }
    const plain = await buildClothing(spec, { type: 'shirt', avatarSheet: false })
    const watched = await buildClothing(spec, {
      type: 'shirt',
      avatarSheet: false,
      onLayer: () => {}
    })

    expect(watched.template).toBe(plain.template)
  })

  it('paints the regions the design targets, which the Inspector then reports', async () => {
    // jsdom has no Image.decode, so this reads the pixels straight off a canvas
    // the engine draws into. Same data the page would measure, without the
    // decode step that only a real browser can do.
    const canvas = document.createElement('canvas')
    const built = await buildClothing(
      { type: 'shirt', layers: [layer({ target: 'torso_front' })] },
      { type: 'shirt', avatarSheet: false, canvas }
    )

    const context = canvas.getContext('2d', { willReadFrequently: true })
    expect(context).not.toBeNull()
    const { data } = context!.getImageData(0, 0, canvas.width, canvas.height)

    const report = paintReport('shirt', paintedByRegion('shirt', data, canvas.width, canvas.height))
    expect(report.empty).not.toContain('torso_front')
    expect(report.empty).toContain('torso_back')
    expect(report.painted).toBeGreaterThan(0)
    expect(report.painted).toBeLessThan(report.total)
    expect(built.report.width).toBe(canvas.width)
  })

  it('refuses a design the validator rejects, before any layer is drawn', async () => {
    const onLayer = vi.fn()
    await expect(
      buildClothing(
        { type: 'shirt', layers: [layer({ color: 'not-a-color' })] },
        { type: 'shirt', avatarSheet: false, onLayer }
      )
    ).rejects.toThrow()
    expect(onLayer).not.toHaveBeenCalled()
  })
})
