import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { useRobloxSelectionStore } from '@/stores/roblox-selection-store'
import { ClothingViewport } from './ClothingViewport'

const { mocks, viewports } = vi.hoisted(() => ({
  mocks: {
    loadArtifactRecords: vi.fn(),
    readAtlasDataUrl: vi.fn(),
    readStillDataUrl: vi.fn()
  },
  viewports: [] as Outfit[]
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

interface Outfit {
  atlases: Partial<Record<'shirt' | 'pants' | 'tshirt', string>>
  primary?: string
  name?: string
}

vi.mock('@/lib/generator/viewport/ArtifactViewportPanel', () => ({
  ArtifactViewportPanel: ({
    artifact,
    placeholder
  }: {
    artifact: Outfit | null
    placeholder?: string
  }) => {
    viewports.push(artifact ?? { atlases: {} })
    return <div data-testid="viewport">{artifact ? 'scene' : placeholder}</div>
  }
}))

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

/** The page composer needs a router; this component renders one. */
function renderViewport(): void {
  render(
    <MemoryRouter initialEntries={['/roblox/clothing']}>
      <ClothingViewport projectPath="/p" />
    </MemoryRouter>
  )
}

describe('ClothingViewport', () => {
  beforeEach(() => {
    mocks.loadArtifactRecords.mockReset()
    mocks.readAtlasDataUrl.mockReset()
    mocks.readStillDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
    mocks.readStillDataUrl.mockResolvedValue(null)
    viewports.length = 0
    useRobloxSelectionStore.setState({
      pickedByProject: {},
      draftByProject: {},
      soloByProject: {}
    })
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      reading: {}
    })
  })

  it('hands the newest atlas to the viewport while nothing was picked', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    renderViewport()

    expect(await screen.findByText('scene')).toBeInTheDocument()
    expect(viewports.some((entry) => entry.atlases.shirt === 'data:image/png;base64,AAAA')).toBe(
      true
    )
  })

  it('switches the viewport when the Side panel picks another record', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    renderViewport()

    expect(await screen.findByText(/\.termul\\generated\\shirt\\royal-robe/)).toBeInTheDocument()

    useRobloxSelectionStore.setState({ pickedByProject: { '/p': 'desert-camo' } })
    expect(await screen.findByText(/\.termul\\generated\\shirt\\desert-camo/)).toBeInTheDocument()
  })

  it('keeps a placeholder when the atlas could not be read', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    mocks.readAtlasDataUrl.mockResolvedValue(null)
    renderViewport()

    expect(await screen.findByText(/Reading v1/)).toBeInTheDocument()
  })

  it('warns about a version that failed its checks', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe', {
        versions: [{ n: 1, at: 1, prompt: 'bad', ok: false, atlas: 'v1.png' }]
      })
    ])
    renderViewport()

    // The fact row and the publish node both report it, so presence is what
    // this asserts, not uniqueness.
    expect((await screen.findAllByText('failed')).length).toBeGreaterThan(0)
  })

  it('invites a pick when the project holds nothing', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([])
    renderViewport()

    // Both the viewport placeholder and the Inspector say it, so this asserts
    // presence rather than uniqueness on purpose.
    expect((await screen.findAllByText(/Pick a garment/)).length).toBeGreaterThan(0)
  })

  async function lastOutfit(): Promise<Outfit> {
    await screen.findByText('scene')
    const outfit = viewports.at(-1)
    if (!outfit) throw new Error('the viewport was never given an outfit')
    return outfit
  }

  it('shows the picked garment alone, never the rest of the collection', async () => {
    // RobloxKit's canvas holds one item. Drawing the whole collection on one
    // avatar made every fresh garment arrive wearing the others.
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe'),
      record('blue-jeans', { versions: [{ n: 1, at: 1, ok: true, design: { type: 'pants' } }] })
    ])
    renderViewport()

    const outfit = await lastOutfit()
    expect(Object.keys(outfit.atlases)).toEqual(['shirt'])
    expect(outfit.primary).toBe('shirt')
  })

  it('shows a picked pair of pants alone too', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe'),
      record('blue-jeans', { versions: [{ n: 1, at: 1, ok: true, design: { type: 'pants' } }] })
    ])
    useRobloxSelectionStore.setState({ pickedByProject: { '/p': 'blue-jeans' } })
    renderViewport()

    const outfit = await lastOutfit()
    expect(Object.keys(outfit.atlases)).toEqual(['pants'])
  })

  it('wears nothing while a draft is open', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    useRobloxSelectionStore.setState({ draftByProject: { '/p': true } })
    renderViewport()

    expect(await screen.findByText(/Describe a garment/)).toBeInTheDocument()
    expect(viewports.every((entry) => Object.keys(entry.atlases).length === 0)).toBe(true)
  })

  it('never shows a different record than the one picked', async () => {
    // Right after a generation lands the pick names a slug the list does not have
    // yet. Falling back to the newest record opened a garment nobody picked.
    mocks.loadArtifactRecords.mockResolvedValue([
      record('some-other-shirt'),
      record('blue-jeans', { versions: [{ n: 1, at: 1, ok: true, design: { type: 'pants' } }] })
    ])
    useRobloxSelectionStore.setState({ pickedByProject: { '/p': 'not-read-yet' } })
    renderViewport()

    // The viewport and the Inspector both say it, so presence is what this
    // asserts rather than uniqueness.
    expect((await screen.findAllByText(/Pick a garment/)).length).toBeGreaterThan(0)
    expect(viewports.every((entry) => Object.keys(entry.atlases).length === 0)).toBe(true)
  })
})
