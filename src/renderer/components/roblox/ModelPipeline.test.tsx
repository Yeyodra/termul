/**
 * The three nodes above the 3D viewport.
 *
 * The 3D page had nothing above the viewport while the clothing page had its four
 * nodes, so a model showed a slug and no facts. RobloxKit's model page carries the
 * same shape (`3d/kind`, `3d/rig` or `3d/shape`, `3d/model`), which is what this
 * mirrors.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord, RecordVersion } from '@/lib/artifact-records'
import { modelFacts } from '@/lib/roblox-inspector'
import type { StageSnapshot } from '@/stores/roblox-stage-store'
import { ModelPipeline } from './ModelPipeline'

const stage = (overrides: Partial<StageSnapshot> = {}): StageSnapshot => ({
  state: 'idle',
  phase: 'idle',
  layer: 0,
  total: 0,
  stage: '',
  detail: null,
  sheet: null,
  base: null,
  error: null,
  ...overrides
})

const record = (version: Partial<RecordVersion> & { n: number }): ArtifactRecord => ({
  slug: 'treasure-chest',
  kind: 'prop',
  current: version.n,
  createdAt: 1,
  updatedAt: 2,
  dir: 'C:/repo/.termul/generated/prop/treasure-chest',
  itemPath: 'C:/repo/.termul/generated/prop/treasure-chest/item.json',
  versions: [{ at: 1, atlas: 'v1.glb', model: 'v1.glb', ...version }]
})

describe('modelFacts', () => {
  it('reads triangles, size and parts from the report', () => {
    const facts = modelFacts({ ok: true, triangles: 1240, size: [4.3, 2.1, 2.8], parts: 6 })
    expect(facts.trianglesLabel).toBe('1,240')
    expect(facts.sizeLabel).toBe('4.3 × 2.1 × 2.8')
    expect(facts.parts).toBe(6)
  })

  it('says unknown rather than inventing numbers for a version with no report', () => {
    const facts = modelFacts(null)
    expect(facts.trianglesLabel).toBe('—')
    expect(facts.sizeLabel).toBe('—')
    expect(facts.parts).toBe(0)
  })

  it('treats a skeleton as rigged and a bare palette as a shape', () => {
    expect(modelFacts(null, { rig: 'custom', skeleton: [{}, {}] }).rigged).toBe(true)
    expect(modelFacts(null, { palette: { a: '#fff', b: '#000' } }).rigged).toBe(false)
    expect(modelFacts(null, { palette: { a: '#fff', b: '#000' } }).colours).toBe(2)
  })

  it('counts parts from the array a real report carries', () => {
    // A generated report lists one entry per top-level part; reading it as a
    // number reported "Parts 0" for every model.
    const facts = modelFacts({ parts: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] })
    expect(facts.parts).toBe(3)
  })
})

describe('ModelPipeline', () => {
  it('shows the three nodes RobloxKit shows', () => {
    const active = record({ n: 1, kind: 'prop' })
    render(
      <ModelPipeline
        record={active}
        version={active.versions[0]}
        stage={stage()}
        onOpenTab={vi.fn()}
      />
    )

    expect(screen.getByText('3d/kind')).toBeInTheDocument()
    expect(screen.getByText('3d/shape')).toBeInTheDocument()
    expect(screen.getByText('3d/model')).toBeInTheDocument()
  })

  it('swaps shape for rig when the model has a skeleton', () => {
    const active = record({ n: 1, kind: 'character' })
    const version = {
      ...active.versions[0],
      report: { ok: true, triangles: 900, size: [2, 4, 2] },
      design: { rig: 'custom', skeleton: [{}, {}] }
    } as RecordVersion
    render(<ModelPipeline record={active} version={version} stage={stage()} onOpenTab={vi.fn()} />)

    expect(screen.getByText('3d/rig')).toBeInTheDocument()
    expect(screen.queryByText('3d/shape')).toBeNull()
    expect(screen.getByText('Joints')).toBeInTheDocument()
  })

  it('reports the triangle count from the checks, not a placeholder', () => {
    const active = record({ n: 1 })
    const version = {
      ...active.versions[0],
      report: { ok: true, triangles: 3388, size: [4, 3, 5] }
    } as RecordVersion
    render(<ModelPipeline record={active} version={version} stage={stage()} onOpenTab={vi.fn()} />)

    expect(screen.getByText('3,388')).toBeInTheDocument()
    expect(screen.getByText('4.0 × 3.0 × 5.0')).toBeInTheDocument()
  })

  it('says ready, running or failed from the version and the stage', () => {
    const active = record({ n: 1, ok: true })
    const withReport = {
      ...active.versions[0],
      report: { ok: true, triangles: 900, size: [2, 4, 2] }
    } as RecordVersion
    const { unmount } = render(
      <ModelPipeline record={active} version={withReport} stage={stage()} onOpenTab={vi.fn()} />
    )
    expect(screen.getByText('ready')).toBeInTheDocument()
    unmount()

    render(
      <ModelPipeline
        record={active}
        version={withReport}
        stage={stage({ state: 'running' })}
        onOpenTab={vi.fn()}
      />
    )
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('opens the tab that explains a node', () => {
    const onOpenTab = vi.fn()
    const active = record({ n: 1 })
    render(
      <ModelPipeline
        record={active}
        version={active.versions[0]}
        stage={stage()}
        onOpenTab={onOpenTab}
      />
    )

    screen.getByText('3d/model').closest('button')?.click()
    expect(onOpenTab).toHaveBeenCalledWith('Use it')
  })

  it('renders with no record at all, so a draft page is not blank above the viewport', () => {
    render(<ModelPipeline record={null} version={null} stage={stage()} onOpenTab={vi.fn()} />)
    expect(screen.getByText('3d/kind')).toBeInTheDocument()
    expect(screen.getAllByText('Nothing yet').length).toBeGreaterThan(0)
  })
})

describe('the pipeline while a build runs', () => {
  it('stays mounted with no record, which is when progress matters most', () => {
    render(
      <ModelPipeline
        record={null}
        version={null}
        stage={stage({ state: 'running', stage: 'designing' })}
        onOpenTab={vi.fn()}
      />
    )

    expect(screen.getByText('3d/kind')).toBeInTheDocument()
    expect(screen.getByText('3d/shape')).toBeInTheDocument()
    expect(screen.getByText('3d/model')).toBeInTheDocument()
  })

  it('says what the engine is doing instead of showing zeros for a model that is not built yet', () => {
    render(
      <ModelPipeline
        record={null}
        version={null}
        stage={stage({ state: 'running', stage: 'building', detail: 'Building it' })}
        onOpenTab={vi.fn()}
      />
    )

    // The engine's own line wins: it is the difference between a spinner and
    // knowing which step is running.
    expect(screen.getByText('Building it')).toBeInTheDocument()
    // A dash, not a zero: a zero reads as a finished model with no geometry.
    expect(screen.getByText('Parts').nextSibling?.textContent).toBe('—')
  })

  it('falls back to the stage name when the engine gives no detail', () => {
    render(
      <ModelPipeline
        record={null}
        version={null}
        stage={stage({ state: 'running', stage: 'checking' })}
        onOpenTab={vi.fn()}
      />
    )
    expect(screen.getByText('checking')).toBeInTheDocument()
  })

  it('shows a dash, not a fake version, before anything is written', () => {
    render(<ModelPipeline record={null} version={null} stage={stage()} onOpenTab={vi.fn()} />)
    expect(screen.getByText('Parts')).toBeInTheDocument()
    expect(screen.queryByText('v1')).toBeNull()
  })
})
