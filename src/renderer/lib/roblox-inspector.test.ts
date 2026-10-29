import { describe, expect, it } from 'vitest'
import type { RecordVersion } from '@/lib/artifact-records'
import { EMPTY_FRACTION, paintedByRegion, paintReport, versionFacts } from './roblox-inspector'

function version(overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    n: 1,
    at: 1_700_000_000_000,
    prompt: 'kemeja flanel merah',
    ok: true,
    atlas: 'v1.png',
    design: {
      type: 'shirt',
      layers: [
        { kind: 'solid', target: 'all', color: '#ff0000' },
        { kind: 'trim', target: 'torso_front', color: '#00ff00', opacity: 0.5 }
      ]
    },
    ...overrides
  }
}

describe('versionFacts', () => {
  it('reads the design the host wrote', () => {
    const facts = versionFacts(version())
    expect(facts.type).toBe('shirt')
    expect(facts.size).toEqual({ width: 585, height: 559 })
    expect(facts.layerCount).toBe(2)
    expect(facts.layerLimit).toBe(40)
    expect(facts.readable).toBe(true)
    expect(facts.ok).toBe(true)
  })

  it('numbers layers from one, the way the engine paints them', () => {
    const facts = versionFacts(version())
    expect(facts.layers.map((layer) => layer.n)).toEqual([1, 2])
    expect(facts.layers[1]).toMatchObject({
      kind: 'trim',
      target: 'torso_front',
      color: '#00ff00',
      opacity: 0.5,
      hidden: false
    })
  })

  it('marks every region touched when a layer targets all', () => {
    const facts = versionFacts(version())
    expect(facts.regions).toHaveLength(18)
    expect(facts.untouched).toEqual([])
    expect(facts.regions.every((region) => region.layers >= 1)).toBe(true)
  })

  it('leaves regions untouched when only one face is painted', () => {
    const facts = versionFacts(
      version({
        design: { type: 'shirt', layers: [{ kind: 'solid', target: 'torso_front' }] }
      })
    )
    expect(facts.untouched).toContain('torso_back')
    expect(facts.untouched).not.toContain('torso_front')
  })

  it('ignores a hidden layer when counting touched regions', () => {
    const facts = versionFacts(
      version({
        design: {
          type: 'shirt',
          layers: [{ kind: 'solid', target: 'all', hidden: true }]
        }
      })
    )
    expect(facts.untouched).toHaveLength(18)
    expect(facts.layers[0]?.hidden).toBe(true)
  })

  it('reports a version it cannot read instead of guessing', () => {
    const facts = versionFacts(version({ design: { type: 'nonsense', layers: [] } }))
    expect(facts.readable).toBe(false)
    expect(facts.layerCount).toBe(0)
    expect(facts.regions).toEqual([])
  })

  it('treats a missing ok as ready, and a false one as failed', () => {
    expect(versionFacts(version({ ok: undefined })).ok).toBe(true)
    expect(versionFacts(version({ ok: false })).ok).toBe(false)
  })
})

describe('paintedByRegion', () => {
  const size = 585
  const height = 559

  function blank(): Uint8ClampedArray {
    return new Uint8ClampedArray(size * height * 4)
  }

  it('reports nothing painted on a transparent atlas', () => {
    const painted = paintedByRegion('shirt', blank(), size, height)
    expect(Object.values(painted).every((fraction) => fraction === 0)).toBe(true)
    expect(paintReport('shirt', painted)).toEqual({
      painted: 0,
      total: 18,
      empty: expect.any(Array)
    })
  })

  it('reports every region painted on a fully opaque atlas', () => {
    const pixels = blank()
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
    const report = paintReport('shirt', paintedByRegion('shirt', pixels, size, height))
    expect(report.painted).toBe(18)
    expect(report.empty).toEqual([])
  })

  it('only counts the regions that were filled', () => {
    const pixels = blank()
    const front = { x: 231, y: 74, w: 128, h: 128 }
    for (let y = front.y; y < front.y + front.h; y += 1) {
      for (let x = front.x; x < front.x + front.w; x += 1) {
        pixels[(y * size + x) * 4 + 3] = 255
      }
    }
    const report = paintReport('shirt', paintedByRegion('shirt', pixels, size, height))
    expect(report.empty).toContain('torso_back')
    expect(report.empty).not.toContain('torso_front')
    expect(report.painted).toBe(1)
  })

  it('never reports an empty region for a t-shirt, which is one full graphic', () => {
    const report = paintReport('tshirt', { graphic: 0 })
    expect(report.empty).toEqual([])
    expect(report.painted).toBe(1)
  })

  it('uses the same empty threshold as the engine check', () => {
    expect(EMPTY_FRACTION).toBe(0.05)
  })
})
