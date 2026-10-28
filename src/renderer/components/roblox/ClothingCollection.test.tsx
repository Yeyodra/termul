import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClothingCollection } from './ClothingCollection'

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

const { viewports } = vi.hoisted(() => ({
  viewports: [] as Array<{ atlas?: string; name?: string }>
}))

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

describe('ClothingCollection', () => {
  beforeEach(() => {
    mocks.loadArtifactRecords.mockReset()
    mocks.readAtlasDataUrl.mockReset()
    mocks.readStillDataUrl.mockReset()
    mocks.readAtlasDataUrl.mockResolvedValue('data:image/png;base64,AAAA')
    mocks.readStillDataUrl.mockResolvedValue(null)
    viewports.length = 0
  })

  it('invites a generation when the project holds nothing', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([])
    render(<ClothingCollection projectPath="/p" />)
    expect(await screen.findByText(/No garment yet/)).toBeInTheDocument()
    expect(mocks.loadArtifactRecords).toHaveBeenCalledWith('/p')
  })

  it('lists every record and selects the newest by default', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe'),
      record('desert-camo', { versions: [{ n: 1, at: 2, prompt: 'camo', atlas: 'v1.png' }] })
    ])
    render(<ClothingCollection projectPath="/p" />)

    const list = await screen.findByRole('list', { name: 'Collection' })
    expect(within(list).getByText('royal-robe')).toBeInTheDocument()
    expect(within(list).getByText('camo')).toBeInTheDocument()
    expect(within(list).getByText('2 items')).toBeInTheDocument()
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
    render(<ClothingCollection projectPath="/p" />)

    expect(await screen.findByText('shirt · v1')).toBeInTheDocument()
    expect(mocks.readAtlasDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'royal-robe' }),
      expect.objectContaining({ n: 1 })
    )
  })

  it('hands the atlas to the viewport once it is read', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    render(<ClothingCollection projectPath="/p" />)

    expect(await screen.findByText('scene')).toBeInTheDocument()
    expect(viewports.some((entry) => entry.atlas === 'data:image/png;base64,AAAA')).toBe(true)
  })

  it('switches the viewport when another record is picked', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe'), record('desert-camo')])
    render(<ClothingCollection projectPath="/p" />)

    const camo = await screen.findByText('desert-camo')
    fireEvent.click(camo)

    expect(await screen.findByText(/\.termul\/generated\/shirt\/desert-camo/)).toBeInTheDocument()
  })

  it('keeps a placeholder when the atlas could not be read', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([record('royal-robe')])
    mocks.readAtlasDataUrl.mockResolvedValue(null)
    render(<ClothingCollection projectPath="/p" />)

    expect(await screen.findByText(/Reading v1/)).toBeInTheDocument()
  })

  it('warns about a version that failed its checks', async () => {
    mocks.loadArtifactRecords.mockResolvedValue([
      record('royal-robe', {
        versions: [{ n: 1, at: 1, prompt: 'bad', ok: false, atlas: 'v1.png' }]
      })
    ])
    render(<ClothingCollection projectPath="/p" />)

    expect(await screen.findByText('failed')).toBeInTheDocument()
  })
})
