import { fireEvent, render, screen, within } from '@testing-library/react'
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
    useRobloxSelectionStore.setState({ pickedByProject: {} })
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
    render(<ClothingList projectPath="/p" />)
    expect(await screen.findByText(/No garment yet/)).toBeInTheDocument()
    expect(mocks.loadArtifactRecords).toHaveBeenCalledWith('/p')
  })

  it('lists every record with its kind and current version', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe'),
      record('desert-camo', { versions: [{ n: 1, at: 2, prompt: 'camo', atlas: 'v1.png' }] })
    ])
    render(<ClothingList projectPath="/p" />)

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
    render(<ClothingList projectPath="/p" />)

    expect(await screen.findByText('Shirt · v1')).toBeInTheDocument()
    expect(mocks.readStillDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'royal-robe' }),
      expect.objectContaining({ n: 1 })
    )
  })

  it('writes the pick to the store so the page can follow it', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    render(<ClothingList projectPath="/p" />)

    fireEvent.click(await screen.findByText('desert-camo'))
    expect(useRobloxSelectionStore.getState().pickedByProject['/p']).toBe('desert-camo')
  })

  it('marks the newest record while nothing was picked', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    render(<ClothingList projectPath="/p" />)

    expect(await screen.findByRole('button', { name: /royal-robe/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('falls back to the newest record when the pick names one that is gone', async () => {
    useRobloxSelectionStore.setState({ pickedByProject: { '/p': 'deleted-slug' } })
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    render(<ClothingList projectPath="/p" />)

    expect(await screen.findByRole('button', { name: /royal-robe/ })).toHaveAttribute(
      'aria-current',
      'true'
    )
  })

  it('renders the generator list above the collection', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    render(<ClothingList projectPath="/p" />)

    expect(await screen.findByRole('button', { name: /Clothing/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Animation/ })).toBeDisabled()
  })
})
