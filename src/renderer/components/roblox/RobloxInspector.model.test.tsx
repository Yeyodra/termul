/**
 * The Inspector on a 3D record, and the `Use it` branch per kind.
 *
 * Two things are pinned here because they were both missing at once:
 *
 *  - the tab set is a prop, so a model page does not render Regions/Layers that
 *    would read garment facts and show nothing
 *  - `Use it` says GLB and the 3D Importer for a model, and PNG and the
 *    dashboard for a garment
 *
 * `isModelRecord` decides from the version's own file rather than `record.kind`,
 * because the host files a record under the generator folder.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { isModelRecord } from '@/lib/artifact-records'
import { CLOTHING_TABS, MODEL_TABS, RobloxInspector, TABS } from './RobloxInspector'

const record = (version: Partial<RecordVersion> & { n: number }): ArtifactRecord => ({
  slug: 'treasure-chest',
  kind: 'prop',
  current: version.n,
  createdAt: 1,
  updatedAt: 2,
  dir: 'C:/repo/.termul/generated/prop/treasure-chest',
  itemPath: 'C:/repo/.termul/generated/prop/treasure-chest/item.json',
  versions: [{ at: 1, atlas: 'v1.glb', ...version }]
})

const garment = (): ArtifactRecord => ({
  slug: 'royal-robe',
  kind: 'shirt',
  current: 1,
  createdAt: 1,
  updatedAt: 2,
  dir: 'C:/repo/.termul/generated/shirt/royal-robe',
  itemPath: 'C:/repo/.termul/generated/shirt/royal-robe/item.json',
  versions: [{ n: 1, at: 1, ok: true, atlas: 'v1.png', design: { type: 'shirt', layers: [] } }]
})

describe('the tab sets', () => {
  it('keeps the clothing set as the default', () => {
    expect([...CLOTHING_TABS]).toEqual(['Checks', 'Regions', 'Layers', 'Versions', 'Use it'])
    expect(TABS).toBe(CLOTHING_TABS)
  })

  it('gives a model no Regions and no Layers, because it has neither', () => {
    expect([...MODEL_TABS]).toEqual(['Checks', 'Versions', 'Use it'])
    expect(MODEL_TABS).not.toContain('Regions')
    expect(MODEL_TABS).not.toContain('Layers')
  })

  it('keeps Versions and Use it in both, so a model can be restored and exported', () => {
    for (const tab of ['Versions', 'Use it'] as const) {
      expect(CLOTHING_TABS).toContain(tab)
      expect(MODEL_TABS).toContain(tab)
    }
  })
})

describe('isModelRecord', () => {
  it('is true when the version wrote a model file', () => {
    expect(isModelRecord(record({ n: 1, model: 'v1.glb' }))).toBe(true)
  })

  it('is true when the atlas itself is a mesh extension', () => {
    expect(isModelRecord(record({ n: 1, atlas: 'v1.glb' }))).toBe(true)
    expect(isModelRecord(record({ n: 1, atlas: 'v1.obj' }))).toBe(true)
    expect(isModelRecord(record({ n: 1, atlas: 'v1.stl' }))).toBe(true)
  })

  it('is false for a garment atlas', () => {
    expect(isModelRecord(garment())).toBe(false)
  })

  it('is false for nothing', () => {
    expect(isModelRecord(null)).toBe(false)
  })
})

describe('the Inspector on a 3D record', () => {
  it('shows the model tab set when the caller passes it', () => {
    const active = record({ n: 1, model: 'v1.glb' })
    render(
      <RobloxInspector
        record={active}
        version={active.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
      />
    )

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Checks', 'Versions', 'Use it'])
  })

  it('still shows five tabs for clothing, so the default is unchanged', () => {
    const active = garment()
    render(<RobloxInspector record={active} version={active.versions[0]} paint={null} />)

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Checks', 'Regions', 'Layers', 'Versions', 'Use it'])
  })

  it('lists every version of a model, so v1 is reachable after a v2', () => {
    const twoVersions: ArtifactRecord = {
      ...record({ n: 1 }),
      current: 2,
      versions: [
        { n: 1, at: 1, ok: true, atlas: 'v1.glb', model: 'v1.glb' },
        { n: 2, at: 2, ok: true, atlas: 'v2.glb', model: 'v2.glb', prompt: 'a bigger chest' }
      ]
    }
    render(
      <RobloxInspector
        record={twoVersions}
        version={twoVersions.versions[1]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Versions"
      />
    )

    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
  })
})

describe('the Use it tab, per kind', () => {
  it('offers a GLB and the 3D Importer for a model', () => {
    const active = record({ n: 1, model: 'v1.glb' })
    render(
      <RobloxInspector
        record={active}
        version={active.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Use it"
      />
    )

    expect(screen.getByRole('button', { name: 'Save GLB to project' })).toBeInTheDocument()
    expect(screen.getByText(/3D Importer/)).toBeInTheDocument()
    expect(screen.getByText(/can be imported straight into Studio/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save PNG/ })).toBeNull()
  })

  it('still offers a PNG and the dashboard for a garment', () => {
    const active = garment()
    render(
      <RobloxInspector record={active} version={active.versions[0]} paint={null} tab="Use it" />
    )

    expect(screen.getByRole('button', { name: 'Save PNG to project' })).toBeInTheDocument()
    expect(screen.getByText(/does not let apps publish classic clothing/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save GLB/ })).toBeNull()
  })

  it('opens the classic dashboard tab for a garment', () => {
    const active = garment()
    render(
      <RobloxInspector record={active} version={active.versions[0]} paint={null} tab="Use it" />
    )
    expect(screen.getByRole('button', { name: /Open Classic Shirts/ })).toBeInTheDocument()
  })

  it('opens the model dashboard tab for a model', () => {
    const active = record({ n: 1, model: 'v1.glb' })
    render(
      <RobloxInspector
        record={active}
        version={active.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Use it"
      />
    )
    expect(screen.getByRole('button', { name: /Open Creator Dashboard/ })).toBeInTheDocument()
  })

  it('keeps Copy folder path in both', () => {
    const model = record({ n: 1, model: 'v1.glb' })
    const { unmount } = render(
      <RobloxInspector
        record={model}
        version={model.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Use it"
      />
    )
    expect(screen.getByRole('button', { name: 'Copy folder path' })).toBeInTheDocument()
    unmount()

    const clothes = garment()
    render(
      <RobloxInspector record={clothes} version={clothes.versions[0]} paint={null} tab="Use it" />
    )
    expect(screen.getByRole('button', { name: 'Copy folder path' })).toBeInTheDocument()
  })
})

describe('the empty hint', () => {
  it('uses the caller hint when nothing is picked', () => {
    render(
      <RobloxInspector
        record={null}
        version={null}
        paint={null}
        tabs={MODEL_TABS}
        emptyHint="Generate a model, then pick it."
      />
    )
    expect(screen.getByText('Generate a model, then pick it.')).toBeInTheDocument()
  })

  it('defaults to the garment hint', () => {
    render(<RobloxInspector record={null} version={null} paint={null} />)
    expect(screen.getByText(/Pick a garment in the Roblox panel/)).toBeInTheDocument()
  })
})

describe('the Checks tab, per kind', () => {
  it('reports model facts instead of a classic template', () => {
    const active: ArtifactRecord = {
      ...record({ n: 1, model: 'v1.glb' }),
      versions: [
        {
          n: 1,
          at: 1,
          ok: true,
          atlas: 'v1.glb',
          model: 'v1.glb',
          kind: 'prop',
          report: { ok: true, triangles: 1240, size: [4.3, 2.1, 2.8], issues: [] }
        }
      ]
    }
    render(
      <RobloxInspector
        record={active}
        version={active.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Checks"
      />
    )

    expect(screen.getByText('A 3D model, not a garment')).toBeInTheDocument()
    expect(screen.getByText('1,240')).toBeInTheDocument()
    expect(screen.getByText('4.30 x 2.10 x 2.80 studs')).toBeInTheDocument()
    expect(screen.getByText('v1.glb')).toBeInTheDocument()
    // The garment checks must not leak onto a model.
    expect(screen.queryByText(/classic template/)).toBeNull()
    expect(screen.queryByText(/Layers/)).toBeNull()
  })

  it('lists the issues a model report carries', () => {
    const active: ArtifactRecord = {
      ...record({ n: 1, model: 'v1.glb' }),
      versions: [
        {
          n: 1,
          at: 1,
          ok: false,
          atlas: 'v1.glb',
          model: 'v1.glb',
          kind: 'prop',
          report: {
            ok: false,
            triangles: 4200,
            size: [1, 1, 1],
            issues: [{ level: 'error', message: '4200 triangles; UGC accessories allow 4000.' }]
          }
        }
      ]
    }
    render(
      <RobloxInspector
        record={active}
        version={active.versions[0]}
        paint={null}
        tabs={MODEL_TABS}
        tab="Checks"
      />
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/UGC accessories allow 4000/)).toBeInTheDocument()
  })

  it('still shows the garment template for clothing', () => {
    const active = garment()
    render(
      <RobloxInspector record={active} version={active.versions[0]} paint={null} tab="Checks" />
    )
    expect(screen.getByText(/classic template/)).toBeInTheDocument()
    expect(screen.queryByText('A 3D model, not a garment')).toBeNull()
  })
})
