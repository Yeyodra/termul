import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import type { StageSnapshot } from '@/stores/roblox-stage-store'
import { NodePipeline } from './NodePipeline'

function version(overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    n: 2,
    at: 1_700_000_000_000,
    prompt: 'a red flannel',
    ok: true,
    atlas: 'v2.png',
    design: {
      type: 'shirt',
      layers: [
        { kind: 'solid', target: 'all', color: '#ff0000' },
        { kind: 'trim', target: 'torso_front', color: '#00ff00' }
      ]
    },
    ...overrides
  }
}

function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    slug: 'royal-robe',
    kind: 'shirt',
    current: 2,
    createdAt: 1,
    updatedAt: 1,
    dir: '/p/.termul/generated/shirt/royal-robe',
    itemPath: '/p/.termul/generated/shirt/royal-robe/item.json',
    versions: [{ n: 1, at: 1, ok: true, atlas: 'v1.png' }, version()],
    ...overrides
  }
}

const IDLE: StageSnapshot = { state: 'idle', layer: 0, total: 0, stage: '', error: null }

function renderPipeline(
  options: {
    stage?: StageSnapshot
    current?: ArtifactRecord | null
    currentVersion?: RecordVersion | null
  } = {}
) {
  const onOpenTab = vi.fn()
  render(
    <NodePipeline
      record={options.current === undefined ? record() : options.current}
      version={options.currentVersion === undefined ? version() : options.currentVersion}
      paint={{ painted: 18, total: 18, empty: [] }}
      stage={options.stage ?? IDLE}
      onOpenTab={onOpenTab}
    />
  )
  return { onOpenTab }
}

describe('NodePipeline', () => {
  it('reports the four nodes in pipeline order', () => {
    renderPipeline()
    const labels = screen.getAllByText(/^(clothing|roblox)\//).map((node) => node.textContent)
    expect(labels).toEqual([
      'clothing/type',
      'clothing/pattern',
      'clothing/template',
      'roblox/publish'
    ])
  })

  it('reads the type, the size and the layer count off the record', () => {
    renderPipeline()
    const typeNode = screen.getByText('clothing/type').closest('button') as HTMLElement
    expect(typeNode).toHaveTextContent('Shirt')
    expect(typeNode).toHaveTextContent('585x559')

    const patternNode = screen.getByText('clothing/pattern').closest('button') as HTMLElement
    expect(patternNode).toHaveTextContent('2')
  })

  it('shows the prompt on the pattern node', () => {
    renderPipeline()
    expect(screen.getByText('"a red flannel"')).toBeInTheDocument()
  })

  it('shows how much of the template is painted', () => {
    renderPipeline()
    expect(screen.getByText('18 / 18')).toBeInTheDocument()
  })

  it('says drawing while a generation runs', () => {
    renderPipeline({
      stage: { state: 'running', layer: 5, total: 7, stage: 'Render', error: null }
    })
    expect(screen.getByText('drawing')).toBeInTheDocument()
  })

  it('says ready when the record checks out', () => {
    renderPipeline()
    expect(screen.getByText('ready')).toBeInTheDocument()
  })

  it('says failed when the record failed its checks', () => {
    renderPipeline({ currentVersion: version({ ok: false }) })
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('says nothing yet while no garment exists', () => {
    renderPipeline({ current: null, currentVersion: null })
    expect(screen.getAllByText('Nothing yet').length).toBeGreaterThan(0)
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('opens the Inspector tab each node stands for', () => {
    const { onOpenTab } = renderPipeline()
    fireEvent.click(screen.getByText('clothing/type'))
    expect(onOpenTab).toHaveBeenLastCalledWith('Checks')

    fireEvent.click(screen.getByText('clothing/pattern'))
    expect(onOpenTab).toHaveBeenLastCalledWith('Layers')

    fireEvent.click(screen.getByText('clothing/template'))
    expect(onOpenTab).toHaveBeenLastCalledWith('Regions')

    fireEvent.click(screen.getByText('roblox/publish'))
    expect(onOpenTab).toHaveBeenLastCalledWith('Use it')
  })

  it('keeps the publish node readable when the slug is long', () => {
    renderPipeline({
      current: record({ slug: 'a-very-long-slug-name-here' }),
      currentVersion: version({ prompt: '' })
    })
    const publish = screen.getByText('roblox/publish').closest('button') as HTMLElement
    expect(within(publish).getByText('a-very-long-slug-name-here')).toBeInTheDocument()
  })
})
