import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { RobloxInspector } from './RobloxInspector'

const { savePngMock } = vi.hoisted(() => ({ savePngMock: vi.fn() }))

vi.mock('@/lib/artifact-records', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/artifact-records')>('@/lib/artifact-records')
  return { ...actual, savePng: savePngMock }
})

vi.mock('@/lib/api', () => ({
  openerApi: { openUrlWithSystemBrowser: vi.fn(async () => ({ success: true, data: undefined })) }
}))

function version(n: number, overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    n,
    at: 1_700_000_000_000,
    prompt: `prompt v${n}`,
    ok: true,
    atlas: `v${n}.png`,
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

function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    slug: 'royal-robe',
    kind: 'shirt',
    current: 1,
    createdAt: 1,
    updatedAt: 1,
    dir: '/p/.termul/generated/shirt/royal-robe',
    itemPath: '/p/.termul/generated/shirt/royal-robe/item.json',
    versions: [version(1)],
    ...overrides
  }
}

describe('RobloxInspector', () => {
  it('invites a pick while nothing is selected', () => {
    render(<RobloxInspector record={null} version={null} paint={null} />)
    expect(screen.getByText(/Pick a garment/)).toBeInTheDocument()
  })

  it('names the garment and its version above the tabs', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    expect(screen.getByText('prompt v1')).toBeInTheDocument()
    expect(screen.getByText('shirt · v1')).toBeInTheDocument()
  })

  it('opens on Checks and reports the template and layer count', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    expect(screen.getByRole('tab', { name: 'Checks' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/585x559 classic template/)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the painted count only once the atlas was measured', () => {
    const { rerender } = render(
      <RobloxInspector record={record()} version={version(1)} paint={null} />
    )
    expect(screen.getByText('—')).toBeInTheDocument()

    rerender(
      <RobloxInspector
        record={record()}
        version={version(1)}
        paint={{ painted: 18, total: 18, empty: [] }}
      />
    )
    expect(screen.getByText('18 / 18')).toBeInTheDocument()
  })

  it('warns about the regions the skin shows through', () => {
    render(
      <RobloxInspector
        record={record()}
        version={version(1)}
        paint={{ painted: 16, total: 18, empty: ['torso_back', 'left_arm_up'] }}
      />
    )
    expect(screen.getByText(/Skin shows on 2 regions/)).toBeInTheDocument()
    expect(screen.getByText(/torso_back, left_arm_up/)).toBeInTheDocument()
  })

  it('marks a failed version instead of claiming it is ready', () => {
    render(<RobloxInspector record={record()} version={version(1, { ok: false })} paint={null} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('lists every region with how many layers paint it', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Regions' }))

    const list = screen.getByRole('list')
    expect(within(list).getByText('torso_front')).toBeInTheDocument()
    expect(within(list).getByText('torso_back')).toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(18)
  })

  it('lists the layers in paint order with their colour and opacity', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Layers' }))

    expect(screen.getByText(/2 layers, painted in order/)).toBeInTheDocument()
    expect(screen.getByText('solid')).toBeInTheDocument()
    expect(screen.getByText('trim')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('says so when a version carries no design', () => {
    render(
      <RobloxInspector record={record()} version={version(1, { design: null })} paint={null} />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Regions' }))
    expect(screen.getByText(/carries no design/)).toBeInTheDocument()
  })

  it('marks the current version and lists the newest first', () => {
    const twoVersions = record({ current: 1, versions: [version(1), version(2)] })
    render(<RobloxInspector record={twoVersions} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('v2')
    expect(rows[1]).toHaveTextContent('v1')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(within(rows[1] as HTMLElement).getByText('Current')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).queryByText('Current')).toBeNull()
  })

  it('hands the upload to the user, and offers both steps', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Use it' }))

    expect(screen.getByText(/the upload is yours/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save PNG to project/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Open Classic Shirts/ })).toBeInTheDocument()
  })

  it('saves the atlas and reports where it went', async () => {
    savePngMock.mockResolvedValue('/p/royal-robe.png')
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Use it' }))
    fireEvent.click(screen.getByRole('button', { name: /Save PNG to project/ }))

    expect(await screen.findByText(/Saved \/p\/royal-robe\.png/)).toBeInTheDocument()
  })

  it('shows why saving failed instead of claiming it worked', async () => {
    savePngMock.mockRejectedValue(new Error('the project folder is gone'))
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Use it' }))
    fireEvent.click(screen.getByRole('button', { name: /Save PNG to project/ }))

    expect(await screen.findByText(/the project folder is gone/)).toBeInTheDocument()
  })

  it('hides the Regions tab for a t-shirt, which is one full-bleed graphic', () => {
    render(
      <RobloxInspector
        record={record({ kind: 'tshirt' })}
        version={version(1, { design: { type: 'tshirt', layers: [{ kind: 'solid' }] } })}
        paint={null}
      />
    )
    expect(screen.queryByRole('tab', { name: 'Regions' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Checks' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Layers' })).toBeInTheDocument()
  })

  it('keeps the Regions tab for a shirt and a pair of pants', () => {
    const { rerender } = render(
      <RobloxInspector record={record()} version={version(1)} paint={null} />
    )
    expect(screen.getByRole('tab', { name: 'Regions' })).toBeInTheDocument()

    rerender(
      <RobloxInspector
        record={record({ kind: 'pants' })}
        version={version(1, { design: { type: 'pants', layers: [{ kind: 'solid' }] } })}
        paint={null}
      />
    )
    expect(screen.getByRole('tab', { name: 'Regions' })).toBeInTheDocument()
  })

  it('falls back to Checks when the selected tab disappears', () => {
    const { rerender } = render(
      <RobloxInspector record={record()} version={version(1)} paint={null} />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Regions' }))
    expect(screen.getByRole('tab', { name: 'Regions' })).toHaveAttribute('aria-selected', 'true')

    rerender(
      <RobloxInspector
        record={record({ kind: 'tshirt' })}
        version={version(1, { design: { type: 'tshirt', layers: [{ kind: 'solid' }] } })}
        paint={null}
      />
    )
    expect(screen.getByRole('tab', { name: 'Checks' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers Restore on every version but the current one', () => {
    const twoVersions = record({ current: 1, versions: [version(1), version(2)] })
    render(
      <RobloxInspector record={twoVersions} version={version(1)} paint={null} onRestore={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))

    const rows = screen.getAllByRole('listitem')
    expect(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Restore' })
    ).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('restores the version whose button was pressed', async () => {
    const onRestore = vi.fn(async () => {})
    const twoVersions = record({ current: 1, versions: [version(1), version(2)] })
    render(
      <RobloxInspector
        record={twoVersions}
        version={version(1)}
        paint={null}
        onRestore={onRestore}
      />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(2))
  })

  it('shows the reason a restore was refused instead of pretending it worked', async () => {
    const onRestore = vi.fn(async () => {
      throw new Error('v2 has no atlas file, so it cannot be shown')
    })
    const twoVersions = record({ current: 1, versions: [version(1), version(2)] })
    render(
      <RobloxInspector
        record={twoVersions}
        version={version(1)}
        paint={null}
        onRestore={onRestore}
      />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/has no atlas file/)).toBeInTheDocument()
  })

  it('disables Restore when no handler was wired', () => {
    const twoVersions = record({ current: 1, versions: [version(1), version(2)] })
    render(<RobloxInspector record={twoVersions} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }))

    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
  })

  it('collapses to a rail and opens again', () => {
    render(<RobloxInspector record={record()} version={version(1)} paint={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide the inspector' }))

    expect(screen.queryByRole('tablist')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show the inspector' }))
    expect(screen.getByRole('tablist', { name: 'Inspector sections' })).toBeInTheDocument()
  })
})
