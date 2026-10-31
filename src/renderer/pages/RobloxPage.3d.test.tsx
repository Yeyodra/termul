/**
 * The feature flag and the 3D page route.
 *
 * These exist because of a real regression: the 3D engine shipped, the flag was
 * flipped, and the page still said "has no engine in this build yet" because it
 * compared against the literal `'clothing'`. A flag nothing reads is a flag that
 * drifts, so the route is pinned to the flag rather than to a feature name.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { featureReady, ROBLOX_FEATURES } from '@/lib/roblox-features'
import { useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { useRobloxSelectionStore } from '@/stores/roblox-selection-store'
import RobloxPage from './RobloxPage'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    project: undefined as unknown,
    loadArtifactRecords: vi.fn(),
    readAtlasDataUrl: vi.fn(),
    readStillDataUrl: vi.fn(),
    readModelDataUrl: vi.fn()
  }
}))

vi.mock('@/stores/project-store', () => ({
  useActiveProject: () => mocks.project
}))

vi.mock('@/lib/artifact-records', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/artifact-records')>('@/lib/artifact-records')
  return {
    ...actual,
    loadArtifactRecords: mocks.loadArtifactRecords,
    readAtlasDataUrl: mocks.readAtlasDataUrl,
    readStillDataUrl: mocks.readStillDataUrl,
    readModelDataUrl: mocks.readModelDataUrl
  }
})

vi.mock('@/lib/generator/viewport/ArtifactViewportPanel', () => ({
  ArtifactViewportPanel: ({
    artifact,
    placeholder
  }: {
    artifact?: { kind?: string; format?: string; name?: string } | null
    placeholder?: string
  }) => (
    <div
      data-testid="viewport"
      data-format={artifact?.kind ?? artifact?.format}
      data-name={artifact?.name}
    >
      {artifact ? 'scene' : placeholder}
    </div>
  )
}))

function renderPage(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roblox/*" element={<RobloxPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('featureReady', () => {
  it('is true for the two engines that exist', () => {
    expect(featureReady('clothing')).toBe(true)
    expect(featureReady('3d')).toBe(true)
  })

  it('is false for the families still to come', () => {
    for (const id of ['vfx', 'gfx', 'icon', 'sfx', 'animation'] as const) {
      expect(featureReady(id), id).toBe(false)
    }
  })

  it('agrees with the flag table it reads', () => {
    for (const feature of ROBLOX_FEATURES) {
      expect(featureReady(feature.id), feature.id).toBe(feature.ready)
    }
  })
})

describe('the 3D page route', () => {
  beforeEach(() => {
    mocks.project = { id: 'p1', name: 'termul', path: 'C:/repo' }
    mocks.loadArtifactRecords.mockReset()
    mocks.loadArtifactRecords.mockResolvedValue([])
    mocks.readAtlasDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue(null)
    mocks.readStillDataUrl.mockReset()
    mocks.readStillDataUrl.mockResolvedValue(null)
    mocks.readModelDataUrl.mockReset()
    mocks.readModelDataUrl.mockResolvedValue(null)
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      models: {},
      reading: {}
    })
    useRobloxSelectionStore.setState({ pickedByProject: {}, draftByProject: {} })
  })

  it('no longer claims the engine is missing', async () => {
    renderPage('/roblox/3d')
    // The regression this file exists for: this text used to appear here.
    expect(screen.queryByText(/has no engine in this build yet/)).toBeNull()
    expect(await screen.findByText(/Describe a model below/)).toBeTruthy()
  })

  it('still refuses a family with no engine', () => {
    renderPage('/roblox/vfx')
    expect(screen.getByText(/VFX has no engine in this build yet/)).toBeInTheDocument()
  })

  it('asks for a project before showing a model', () => {
    mocks.project = undefined
    renderPage('/roblox/3d')
    expect(screen.getByText(/Open a project first/)).toBeInTheDocument()
  })

  it('mounts the model viewport and hands it the stored spec', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      {
        slug: 'wooden-crate',
        kind: '3d',
        current: 1,
        createdAt: 1,
        updatedAt: 2,
        dir: 'C:/repo/.termul/generated/3d/wooden-crate',
        itemPath: 'C:/repo/.termul/generated/3d/wooden-crate/item.json',
        versions: [
          {
            n: 1,
            at: 1,
            prompt: 'a wooden crate',
            ok: true,
            atlas: 'v1.glb',
            model: 'v1.glb',
            // The spec is what the viewport draws from: without it there is no
            // model to build, which is why a version saved before the spec was
            // kept renders nothing.
            design: {
              version: 1,
              name: 'Wooden crate',
              category: 'prop',
              palette: { wood: '#8a5a2b' },
              parts: [{ type: 'box', size: [2, 2, 2], color: 'wood' }]
            }
          }
        ]
      }
    ])
    mocks.readModelDataUrl.mockResolvedValue('data:model/gltf-binary;base64,Z2xURgIAAAA=')

    renderPage('/roblox/3d')

    const viewport = await screen.findByTestId('viewport')
    expect(viewport).toHaveAttribute('data-format', 'model')
    expect(viewport).toHaveAttribute('data-name', 'a wooden crate')
    expect(await screen.findByText('scene')).toBeInTheDocument()
  })

  it('does not put a clothing record into the 3D viewport', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      {
        slug: 'royal-robe',
        kind: 'shirt',
        current: 1,
        createdAt: 1,
        updatedAt: 2,
        dir: 'C:/repo/.termul/generated/shirt/royal-robe',
        itemPath: 'C:/repo/.termul/generated/shirt/royal-robe/item.json',
        versions: [{ n: 1, at: 1, atlas: 'v1.png' }]
      }
    ])

    renderPage('/roblox/3d')

    const viewport = await screen.findByTestId('viewport')
    // No model file on the version, so nothing is drawn and the placeholder shows.
    expect(viewport).not.toHaveAttribute('data-format', 'glb')
    expect(await screen.findByText(/Describe a model below/)).toBeInTheDocument()
  })

  it('keeps clothing on its own viewport', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([])
    renderPage('/roblox/clothing')
    expect((await screen.findAllByText(/Pick a garment/)).length).toBeGreaterThan(0)
  })

  it('shows nothing after New, even though a model exists', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      {
        slug: 'a-brown-puppy',
        kind: 'character',
        current: 1,
        createdAt: 1,
        updatedAt: 2,
        dir: 'C:/repo/.termul/generated/character/a-brown-puppy',
        itemPath: 'C:/repo/.termul/generated/character/a-brown-puppy/item.json',
        versions: [
          {
            n: 1,
            at: 1,
            prompt: 'a brown puppy',
            ok: true,
            kind: 'character',
            atlas: 'v1.glb',
            model: 'v1.glb',
            design: {
              version: 1,
              name: 'Puppy',
              category: 'character',
              palette: { fur: '#c98a4b' },
              parts: [{ type: 'box', size: [2, 2, 2], color: 'fur' }]
            }
          }
        ]
      }
    ])
    // New clears the pick; without a draft check the viewport fell back to the
    // newest record and the button looked like it did nothing.
    useRobloxSelectionStore.setState({ draftByProject: { 'C:/repo': true } })

    renderPage('/roblox/3d')

    const viewport = await screen.findByTestId('viewport')
    expect(viewport).not.toHaveAttribute('data-format', 'model')
    expect(await screen.findByText(/press Make it/)).toBeInTheDocument()
  })
})
