import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { useRobloxSelectionStore } from '@/stores/roblox-selection-store'
import RobloxPage from './RobloxPage'

const { mocks, viewports } = vi.hoisted(() => ({
  mocks: {
    project: undefined as unknown,
    loadArtifactRecords: vi.fn(),
    readAtlasDataUrl: vi.fn(),
    readStillDataUrl: vi.fn()
  },
  viewports: [] as Array<{ atlas?: string; name?: string }>
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
    readStillDataUrl: mocks.readStillDataUrl
  }
})

vi.mock('@/lib/generator/viewport/ArtifactViewportPanel', () => ({
  ArtifactViewportPanel: ({
    artifact,
    placeholder
  }: {
    artifact: unknown
    placeholder?: string
  }) => {
    viewports.push((artifact ?? {}) as { atlas?: string; name?: string })
    return <div data-testid="viewport">{artifact ? 'scene' : placeholder}</div>
  }
}))

function renderPage(initialPath = '/roblox/clothing'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/roblox/*" element={<RobloxPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RobloxPage', () => {
  beforeEach(() => {
    mocks.project = { id: 'p1', name: 'termul', path: 'C:/repo' }
    mocks.loadArtifactRecords.mockReset()
    mocks.loadArtifactRecords.mockResolvedValue([])
    mocks.readAtlasDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue(null)
    mocks.readStillDataUrl.mockReset()
    mocks.readStillDataUrl.mockResolvedValue(null)
    viewports.length = 0
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      models: {},
      reading: {}
    })
    useRobloxSelectionStore.setState({ pickedByProject: {} })
  })

  it('shows the viewport instead of a column of its own', async () => {
    renderPage()
    expect((await screen.findAllByText(/Pick a garment/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('list', { name: 'Collection' })).toBeNull()
  })

  it('says a project is needed before a garment can be written', () => {
    mocks.project = undefined
    renderPage()
    expect(screen.getByText(/Open a project first/)).toBeInTheDocument()
  })

  it('reads the feature from the URL', () => {
    renderPage('/roblox/vfx')
    expect(screen.getByText(/VFX has no engine/)).toBeInTheDocument()
  })

  it('falls back to clothing for an unknown segment', async () => {
    renderPage('/roblox/nonsense')
    expect((await screen.findAllByText(/Pick a garment/)).length).toBeGreaterThan(0)
  })

  it('shows the garment the Side panel picked', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      {
        slug: 'royal-robe',
        kind: 'shirt',
        current: 2,
        createdAt: 1,
        updatedAt: 2,
        dir: 'C:/repo/.termul/generated/shirt/royal-robe',
        itemPath: 'C:/repo/.termul/generated/shirt/royal-robe/item.json',
        versions: [
          { n: 1, at: 1, atlas: 'v1.png' },
          { n: 2, at: 2, prompt: 'a red flannel', ok: true, atlas: 'v2.png' }
        ]
      }
    ])
    mocks.readAtlasDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
    useRobloxSelectionStore.setState({ pickedByProject: { 'C:/repo': 'shirt:royal-robe' } })

    renderPage()
    expect(await screen.findByText('scene')).toBeInTheDocument()
    expect(viewports.some((entry) => entry.name === 'a red flannel')).toBe(true)
  })
})
