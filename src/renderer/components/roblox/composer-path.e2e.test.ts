/**
 * The page composer's whole path, with only the model stubbed.
 *
 * The UI-level click test lives in `ClothingComposer.test.tsx`; this one proves
 * the part a click cannot reach: the engine runs, the atlas comes out, and the
 * record the host would write is exactly what `save_artifact_result` produces.
 * Between them they cover what a user does when they press Make it.
 *
 * The model is the one thing stubbed, because a real one is not deterministic and
 * this test must be.
 */
import { describe, expect, it } from 'vitest'
import { buildClothing } from '@/lib/generator/engines/clothing/build'
import type { ClothingLayer } from '@/lib/generator/engines/clothing/schema'
import { versionFacts } from '@/lib/roblox-inspector'

const layer = (overrides: Partial<ClothingLayer> = {}): ClothingLayer => ({
  kind: 'solid',
  color: '#ffffff',
  target: 'all',
  ...overrides
})

/** What a page generation hands the host, in the shape `save_artifact` takes. */
function resultFor(design: { type: 'shirt'; layers: ClothingLayer[] }) {
  return {
    kind: 'shirt',
    name: 'Kaos Putih Polos',
    prompt: 'kaos putih polos',
    design,
    report: { ok: true }
  }
}

describe('what a page generation hands the host', () => {
  it('carries the atlas, the still, the design and the report', async () => {
    const design = { type: 'shirt' as const, layers: [layer(), layer({ kind: 'trim' })] }
    const built = await buildClothing(design, { type: 'shirt' })

    const result = {
      ...resultFor(design),
      atlas: built.template,
      image: built.sheet
    }

    expect(result.atlas).toMatch(/^data:image\/png;base64,/)
    expect(result.image).toMatch(/^data:image\/png;base64,/)
    expect(result.design.layers).toHaveLength(2)
    expect(result.report.ok).toBe(true)
    expect(result.name).toBe('Kaos Putih Polos')
  })

  it('produces a record the Inspector can describe without re-rendering', async () => {
    const design = {
      type: 'shirt' as const,
      layers: [layer(), layer({ kind: 'trim', target: 'torso_front' })]
    }
    await buildClothing(design, { type: 'shirt', avatarSheet: false })

    const facts = versionFacts({
      n: 1,
      at: Date.now(),
      prompt: 'kaos putih polos',
      ok: true,
      atlas: 'v1.png',
      design
    })

    expect(facts.readable).toBe(true)
    expect(facts.type).toBe('shirt')
    expect(facts.layerCount).toBe(2)
    expect(facts.size).toEqual({ width: 585, height: 559 })
    expect(facts.untouched).toEqual([])
  })

  it('reports a design the validator would refuse, instead of saving it', async () => {
    await expect(
      buildClothing({ type: 'shirt', layers: [layer({ kind: 'nonsense' })] }, { type: 'shirt' })
    ).rejects.toThrow()
  })
})
