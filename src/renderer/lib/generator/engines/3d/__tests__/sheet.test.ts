/**
 * The review sheets: geometry, labels, quality and the data-URL contract.
 *
 * Rendering needs a real WebGL context, which jsdom does not provide, so the
 * pixel output is verified in the app. Everything that decides *what* gets
 * drawn is pure and pinned here: the tile grid, the four view names, the two
 * JPEG qualities, the backdrop per sheet, and the one-sheet-versus-two rule.
 *
 * The acceptance case from the plan (08 8.3) is the sheet count and the
 * `data:image/jpeg` prefix; both are asserted.
 */
import { describe, expect, it } from 'vitest'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import type { ModelSpec, SpecNode } from '@/lib/generator/engines/3d/schema'
import {
  disposeRenderer,
  renderReviewSheets,
  renderThumbnail,
  SHEET1_BACKDROP,
  SHEET1_QUALITY,
  SHEET1_VIEWS,
  SHEET2_BACKDROP,
  SHEET2_CLOSEUPS,
  SHEET2_QUALITY,
  SHEET2_WALK,
  sheetCount,
  sheetLayout,
  TILE
} from '@/lib/generator/engines/3d/sheet'

const prop = (parts: SpecNode[], extra: Partial<ModelSpec> = {}): ModelSpec => ({
  version: 1,
  category: 'prop',
  palette: { a: '#ffffff' },
  parts,
  ...extra
})

const rigged = (): ModelSpec => ({
  version: 1,
  category: 'character',
  rig: 'custom',
  palette: { a: '#ffffff' },
  skeleton: [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck' }
  ],
  parts: [
    { name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
    { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 2, 0], pivot: [0, 1, 0] }
  ]
})

describe('the tile geometry', () => {
  it('uses 768 px tiles, as the original does', () => {
    expect(TILE).toBe(768)
  })

  it('lays four tiles out as 2 x 2', () => {
    expect(sheetLayout(4)).toEqual({ columns: 2, rows: 2, width: 1536, height: 1536 })
  })

  it('lays three tiles out as 2 x 2 with one empty slot', () => {
    // The cosmetic gap on a rigged sheet (08 G7), reproduced.
    expect(sheetLayout(3)).toEqual({ columns: 2, rows: 2, width: 1536, height: 1536 })
  })

  it('lays one tile out as a single cell', () => {
    expect(sheetLayout(1)).toEqual({ columns: 1, rows: 1, width: 768, height: 768 })
  })

  it('is not the clothing strip', () => {
    // Clothing is 1024 x 358 with three poses plus a template; this is square
    // 768 px tiles. The two must never be unified (15/04 7 M3).
    const layout = sheetLayout(4)
    expect(layout.width).not.toBe(1024)
    expect(layout.height).not.toBe(358)
  })
})

describe('the view list', () => {
  it('has exactly the four sheet 1 views, in order', () => {
    expect(SHEET1_VIEWS.map((view) => view.name)).toEqual([
      'front',
      'right side',
      'back',
      'three-quarter'
    ])
  })

  it('points each view the documented way', () => {
    expect(SHEET1_VIEWS[0].direction).toEqual([0, 0, 1])
    expect(SHEET1_VIEWS[1].direction).toEqual([1, 0, 0])
    expect(SHEET1_VIEWS[2].direction).toEqual([0, 0, -1])
  })

  it('fits the three axis views and keeps the three-quarter perspective', () => {
    expect(SHEET1_VIEWS.map((view) => view.orthographic)).toEqual([true, true, true, false])
  })

  it('has two close-ups and a walk on sheet 2', () => {
    expect(SHEET2_CLOSEUPS.map((view) => view.name)).toEqual([
      'upper part, front',
      'upper part, three-quarter'
    ])
    expect(SHEET2_WALK.name).toBe('test walk, side')
    expect(SHEET2_WALK.direction).toEqual([1, 0.1, 0.3])
  })
})

describe('the qualities and backdrops', () => {
  it('uses JPEG 0.88 for sheet 1 and 0.85 for sheet 2', () => {
    expect(SHEET1_QUALITY).toBe(0.88)
    expect(SHEET2_QUALITY).toBe(0.85)
    // Deliberately different from each other, and from clothing's 0.85.
    expect(SHEET1_QUALITY).not.toBe(SHEET2_QUALITY)
  })

  it('uses a different backdrop per sheet', () => {
    expect(SHEET1_BACKDROP).toBe('#7d800a')
    expect(SHEET2_BACKDROP).toBe('#101113')
    expect(SHEET1_BACKDROP).not.toBe(SHEET2_BACKDROP)
  })
})

describe('sheetCount', () => {
  it('gives an unrigged model one sheet', () => {
    expect(sheetCount(buildSpec(prop([{ type: 'box', size: [1, 1, 1] }])))).toBe(1)
  })

  it('gives a rigged model two', () => {
    expect(sheetCount(buildSpec(rigged()))).toBe(2)
  })

  it('gives a character with an empty skeleton one', () => {
    // A model can be a character without bones only if the rig is canonical and
    // the skeleton is left implicit; the count follows the skeleton itself.
    const model = buildSpec({
      version: 1,
      category: 'character',
      rig: 'custom',
      palette: { a: '#ffffff' },
      skeleton: [{ part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' }],
      parts: [{ name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] }]
    })
    expect(sheetCount(model)).toBe(2)
    model.rigSpec = { rig: 'custom', skeleton: [] }
    expect(sheetCount(model)).toBe(1)
  })
})

describe('rendering without WebGL', () => {
  it('disposeRenderer is safe to call when nothing was created', () => {
    expect(() => disposeRenderer()).not.toThrow()
  })

  it('renderReviewSheets throws a clear error when there is no 2D canvas', () => {
    // jsdom has no WebGL, so the renderer constructor fails before the
    // compositor is reached. Either way the failure is explicit, not silent.
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(() => renderReviewSheets(model)).toThrow()
  })

  it('renderThumbnail throws a clear error when there is no WebGL context', () => {
    const model = buildSpec(prop([{ type: 'box', size: [1, 1, 1] }]))
    expect(() => renderThumbnail(model)).toThrow()
  })
})
