import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '@/lib/artifact-records'
import { ClothingComposer, revisionPrompt } from './ClothingComposer'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    project: undefined as unknown,
    write: vi.fn(),
    showAgentLauncher: vi.fn(),
    activePaneId: 'pane-1' as string | null
  }
}))

vi.mock('@/stores/project-store', () => ({
  useActiveProject: () => mocks.project
}))

vi.mock('@/lib/api', () => ({
  persistenceApi: { write: mocks.write }
}))

vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: {
    getState: () => ({
      activePaneId: mocks.activePaneId,
      showAgentLauncher: mocks.showAgentLauncher
    })
  }
}))

function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    slug: 'royal-robe',
    kind: 'shirt',
    current: 2,
    createdAt: 1,
    updatedAt: 1,
    dir: '/p/.termul/generated/shirt/royal-robe',
    itemPath: '/p/.termul/generated/shirt/royal-robe/item.json',
    versions: [
      { n: 1, at: 1, prompt: 'first', ok: true, atlas: 'v1.png' },
      { n: 2, at: 2, prompt: 'a red flannel', ok: true, atlas: 'v2.png' }
    ],
    ...overrides
  }
}

function renderComposer(current: ArtifactRecord | null = record()): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ClothingComposer record={current} />
    </MemoryRouter>
  )
}

describe('revisionPrompt', () => {
  it('names the garment and asks to keep it, so the host files a new version', () => {
    const prompt = revisionPrompt(record(), '  make the stripes thinner  ')
    expect(prompt).toContain('"a red flannel"')
    expect(prompt).toContain('(v2)')
    expect(prompt).toContain('Change: make the stripes thinner.')
    expect(prompt).toContain('keep the same name')
  })

  it('falls back to the slug when the version has no prompt', () => {
    const bare = record({ versions: [{ n: 1, at: 1, ok: true, atlas: 'v1.png' }], current: 1 })
    expect(revisionPrompt(bare, 'brighter')).toContain('"royal-robe"')
  })
})

describe('ClothingComposer', () => {
  beforeEach(() => {
    mocks.project = { id: 'p1', name: 'termul', path: '/p' }
    mocks.write.mockReset()
    mocks.write.mockResolvedValue({ success: true, data: undefined })
    mocks.showAgentLauncher.mockReset()
    mocks.activePaneId = 'pane-1'
  })

  it('keeps both actions disabled until something is typed', () => {
    renderComposer()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /New/ })).toBeDisabled()
  })

  it('sends a new garment through the launcher draft', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), {
      target: { value: 'a blue parka' }
    })
    fireEvent.click(screen.getByRole('button', { name: /New/ }))

    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith('last-launch-draft/p1', 'a blue parka')
    )
    expect(mocks.showAgentLauncher).toHaveBeenCalledWith('pane-1')
  })

  it('sends Apply as a revision of the garment on screen', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), {
      target: { value: 'thinner stripes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
    const [, text] = mocks.write.mock.calls[0] as [string, string]
    expect(text).toContain('Revise the existing garment')
    expect(text).toContain('thinner stripes')
  })

  it('disables Apply while no garment is picked', () => {
    renderComposer(null)
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /New/ })).toBeEnabled()
  })

  it('does nothing without a project', async () => {
    mocks.project = undefined
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'a hat' } })
    expect(screen.getByRole('button', { name: /New/ })).toBeDisabled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('sends on Enter', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    fireEvent.change(field, { target: { value: 'a green tee' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith('last-launch-draft/p1', 'a green tee')
    )
  })

  it('clears the field after handing the prompt over', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    fireEvent.change(field, { target: { value: 'a green tee' } })
    fireEvent.click(screen.getByRole('button', { name: /New/ }))

    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('still opens the launcher when the draft write fails', async () => {
    mocks.write.mockRejectedValue(new Error('store unavailable'))
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'a hat' } })
    fireEvent.click(screen.getByRole('button', { name: /New/ }))

    await waitFor(() => expect(mocks.showAgentLauncher).toHaveBeenCalledWith('pane-1'))
  })
})
