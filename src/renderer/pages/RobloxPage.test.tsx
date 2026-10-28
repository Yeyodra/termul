import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RobloxPage from './RobloxPage'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    project: undefined as unknown,
    loadArtifactRecords: vi.fn()
  }
}))

vi.mock('@/stores/project-store', () => ({
  useActiveProject: () => mocks.project
}))

vi.mock('@/lib/artifact-records', () => ({
  loadArtifactRecords: mocks.loadArtifactRecords,
  currentVersion: (record: { versions: unknown[]; current: number }) =>
    record.versions.find((v) => (v as { n: number }).n === record.current) ??
    record.versions[record.versions.length - 1],
  readAtlasDataUrl: vi.fn(async () => null),
  readStillDataUrl: vi.fn(async () => null)
}))

vi.mock('@/lib/generator/viewport/ArtifactViewportPanel', () => ({
  ArtifactViewportPanel: ({ placeholder }: { placeholder?: string }) => <div>{placeholder}</div>
}))

function renderPage(): void {
  render(
    <MemoryRouter>
      <RobloxPage />
    </MemoryRouter>
  )
}

describe('RobloxPage', () => {
  beforeEach(() => {
    mocks.project = { id: 'p1', name: 'termul', path: 'C:/repo' }
    mocks.loadArtifactRecords.mockReset()
    mocks.loadArtifactRecords.mockResolvedValue([])
  })

  it('lists every generator and marks the unimplemented ones as soon', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /Clothing/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /3D Generator/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Animation/ })).toBeDisabled()
    expect(screen.getAllByText('soon')).toHaveLength(6)
  })

  it('says a project is needed before a garment can be written', () => {
    mocks.project = undefined
    renderPage()
    expect(screen.getByText(/Open a project first/)).toBeInTheDocument()
  })

  it('reads the collection from the project folder', async () => {
    renderPage()
    expect(await screen.findByText(/No garment yet/)).toBeInTheDocument()
    expect(mocks.loadArtifactRecords).toHaveBeenCalledWith('C:/repo')
  })

  it('lists a record the project already holds', async () => {
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
    renderPage()
    expect(await screen.findByText('a red flannel')).toBeInTheDocument()
    expect(screen.getByText('shirt · v2')).toBeInTheDocument()
  })
})
