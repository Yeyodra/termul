import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { useRobloxSelectionStore } from '@/stores/roblox-selection-store'
import { ClothingList } from './ClothingList'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    loadArtifactRecords: vi.fn(),
    readAtlasDataUrl: vi.fn(),
    readStillDataUrl: vi.fn()
  }
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

function LocationProbe(): React.JSX.Element {
  return <div data-testid="location">{useLocation().pathname}</div>
}

/** The list navigates on a pick, so it needs a router. */
function renderList(): void {
  render(
    <MemoryRouter initialEntries={['/roblox/clothing']}>
      <ClothingList projectPath="/p" />
    </MemoryRouter>
  )
}

function record(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    kind: 'shirt',
    current: 1,
    createdAt: 1,
    updatedAt: 1,
    dir: `/p/.termul/generated/shirt/${slug}`,
    itemPath: `/p/.termul/generated/shirt/${slug}/item.json`,
    versions: [{ n: 1, at: 1, prompt: slug, ok: true, design: { type: 'shirt' }, atlas: 'v1.png' }],
    ...overrides
  }
}

describe('ClothingList', () => {
  beforeEach(() => {
    mocks.loadArtifactRecords.mockReset()
    mocks.readAtlasDataUrl.mockReset()
    mocks.readStillDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
    mocks.readStillDataUrl.mockResolvedValue(null)
    useRobloxSelectionStore.setState({ pickedByProject: {}, draftByProject: {} })
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      reading: {}
    })
  })

  it('invites a generation when the project holds nothing', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([])
    renderList()
    expect(await screen.findByText(/No garment yet/)).toBeInTheDocument()
    expect(mocks.loadArtifactRecords).toHaveBeenCalledWith('/p')
  })

  it('lists every record with its kind and current version', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe'),
      record('desert-camo', { versions: [{ n: 1, at: 2, prompt: 'camo', atlas: 'v1.png' }] })
    ])
    renderList()

    const list = await screen.findByRole('list', { name: 'Collection' })
    expect(within(list).getByText('royal-robe')).toBeInTheDocument()
    expect(within(list).getByText('camo')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
  })

  it('shows the current version, not the newest, when the pointer was restored', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe', {
        current: 1,
        versions: [
          { n: 1, at: 1, prompt: 'first', atlas: 'v1.png' },
          { n: 2, at: 2, prompt: 'second', atlas: 'v2.png' }
        ]
      })
    ])
    renderList()

    expect(await screen.findByText('Shirt Â· v1')).toBeInTheDocument()
    expect(mocks.readStillDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'royal-robe' }),
      expect.objectContaining({ n: 1 })
    )
  })

  it('writes the pick to the store so the page can follow it', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    renderList()

    fireEvent.click(await screen.findByText('desert-camo'))
    expect(useRobloxSelectionStore.getState().pickedByProject['/p']).toBe('desert-camo')
  })

  it('opens the feature page when a row is picked, as RobloxKit does', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    render(
      <MemoryRouter initialEntries={['/']}>
        <ClothingList projectPath="/p" />
        <LocationProbe />
      </MemoryRouter>
    )

    expect(await screen.findByTestId('location')).toHaveTextContent('/')
    fireEvent.click(await screen.findByText('royal-robe'))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/roblox/clothing')
    )
  })

  it('marks the newest record while nothing was picked', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    renderList()

    const row = await screen.findByText('royal-robe')
    expect(row.closest('button')).toHaveAttribute('aria-current', 'true')
  })

  it('falls back to the newest record when the pick names one that is gone', async () => {
    useRobloxSelectionStore.setState({ pickedByProject: { '/p': 'deleted-slug' } })
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    renderList()

    const row = await screen.findByText('royal-robe')
    expect(row.closest('button')).toHaveAttribute('aria-current', 'true')
  })

  it('renders the generator list above the collection', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    renderList()

    expect(await screen.findByRole('button', { name: /Clothing/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Animation/ })).toBeDisabled()
  })

  it('starts a blank garment from New, without touching the pick', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    render(
      <MemoryRouter initialEntries={['/']}>
        <ClothingList projectPath="/p" />
        <LocationProbe />
      </MemoryRouter>
    )

    const newButton = await screen.findByRole('button', { name: 'New' })
    fireEvent.click(newButton)

    // A draft is its own state: the collection keeps a pick, the page ignores it.
    expect(useRobloxSelectionStore.getState().draftByProject['/p']).toBe(true)
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/roblox/clothing')
    )
  })

  it('ends the draft when a row is picked again', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    useRobloxSelectionStore.setState({ draftByProject: { '/p': true } })
    renderList()

    fireEvent.click(await screen.findByText('royal-robe'))
    expect(useRobloxSelectionStore.getState().draftByProject['/p']).toBeUndefined()
  })
})

describe('the collection is split per generator', () => {
  beforeEach(() => {
    mocks.loadArtifactRecords.mockReset()
    mocks.readAtlasDataUrl.mockReset()
    mocks.readStillDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
    mocks.readStillDataUrl.mockResolvedValue(null)
    useRobloxSelectionStore.setState({ pickedByProject: {}, draftByProject: {} })
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      reading: {}
    })
  })

  function model(slug: string) {
    return record(slug, {
      kind: 'prop',
      dir: `/p/.termul/generated/prop/${slug}`,
      versions: [
        { n: 1, at: 1, prompt: slug, ok: true, kind: 'prop', atlas: 'v1.glb', model: 'v1.glb' }
      ]
    })
  }

  function renderAt(path: string): void {
    render(
      <MemoryRouter initialEntries={[path]}>
        <ClothingList projectPath="/p" feature={path.endsWith('3d') ? '3d' : 'clothing'} />
      </MemoryRouter>
    )
  }

  it('keeps a model out of the clothing collection', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), model('treasure-chest')])
    renderAt('/roblox/clothing')

    const list = await screen.findByRole('list', { name: 'Collection' })
    expect(within(list).getByText('royal-robe')).toBeInTheDocument()
    expect(within(list).queryByText('treasure-chest')).toBeNull()
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })

  it('keeps a garment out of the 3D collection', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), model('treasure-chest')])
    renderAt('/roblox/3d')

    const list = await screen.findByRole('list', { name: 'Collection' })
    expect(within(list).getByText('treasure-chest')).toBeInTheDocument()
    expect(within(list).queryByText('royal-robe')).toBeNull()
    expect(screen.getByText('1 item')).toBeInTheDocument()
  })

  it('offers no kind filter entry for the other generator', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), model('treasure-chest')])
    renderAt('/roblox/3d')

    const select = await screen.findByRole('combobox', { name: /Filter by kind/ })
    const labels = [...select.querySelectorAll('option')].map((option) => option.textContent)
    expect(labels).toContain('prop')
    expect(labels).not.toContain('Shirt')
  })

  it('invites a model, not a garment, when the 3D collection is empty', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    renderAt('/roblox/3d')

    expect(await screen.findByText(/No model yet/)).toBeInTheDocument()
    expect(screen.queryByText(/No garment yet/)).toBeNull()
  })

  it('still invites a garment when only models exist', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([model('treasure-chest')])
    renderAt('/roblox/clothing')

    expect(await screen.findByText(/No garment yet/)).toBeInTheDocument()
  })
})
