import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '@/lib/artifact-records'
import { ClothingComposer, revisionPrompt } from './ClothingComposer'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    runPageGeneration: vi.fn()
  }
}))

vi.mock('@/lib/roblox-generate', () => ({
  runPageGeneration: mocks.runPageGeneration
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

function renderComposer(current: ArtifactRecord | null = record(), onSettled = vi.fn()) {
  render(<ClothingComposer projectPath="/p" record={current} onSettled={onSettled} />)
  return { onSettled }
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
    mocks.runPageGeneration.mockReset()
    mocks.runPageGeneration.mockResolvedValue({
      status: 'done',
      saved: {
        slug: 'green-tee',
        version: 1,
        path: '/p/x.png',
        relative: 'x.png',
        itemPath: '/p/i.json'
      }
    })
  })

  it('keeps both actions disabled until something is typed', () => {
    renderComposer()
    expect(screen.getByRole('button', { name: /Make it/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled()
  })

  it('generates from the page itself, with no chat involved', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), {
      target: { value: 'a green tee' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    await waitFor(() =>
      expect(mocks.runPageGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: '/p', prompt: 'a green tee', type: 'shirt' })
      )
    )
  })

  it('sends Apply as a revision of the garment on screen', async () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), {
      target: { value: 'thinner stripes' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))

    await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalledTimes(1))
    const [options] = mocks.runPageGeneration.mock.calls[0] as [{ prompt: string }]
    expect(options.prompt).toContain('Revise the existing garment')
    expect(options.prompt).toContain('thinner stripes')
  })

  it('disables Apply while no garment is picked', () => {
    renderComposer(null)
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Make it/ })).toBeEnabled()
  })

  it('lets the kind be picked before generating', async () => {
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Pants' }))
    fireEvent.change(screen.getByLabelText('Describe a garment'), {
      target: { value: 'blue jeans' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    await waitFor(() =>
      expect(mocks.runPageGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pants' })
      )
    )
  })

  it('tells the page to re-read the project once a garment lands', async () => {
    const { onSettled } = renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'a hat' } })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    await waitFor(() => expect(onSettled).toHaveBeenCalled())
  })

  it('clears the field after a garment lands', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    fireEvent.change(field, { target: { value: 'a green tee' } })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('shows why a generation failed instead of pretending it worked', async () => {
    mocks.runPageGeneration.mockResolvedValue({ status: 'failed', error: 'the model ran out' })
    renderComposer()
    fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: 'a hat' } })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    expect(await screen.findByText('the model ran out')).toBeInTheDocument()
  })

  it('keeps the prompt when the generation was cancelled', async () => {
    mocks.runPageGeneration.mockResolvedValue({ status: 'cancelled' })
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    fireEvent.change(field, { target: { value: 'a hat' } })
    fireEvent.click(screen.getByRole('button', { name: /Make it/ }))

    await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalled())
    expect(field).toHaveValue('a hat')
  })

  it('sends on Enter', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    fireEvent.change(field, { target: { value: 'a green tee' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalledTimes(1))
  })
})
