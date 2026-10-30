import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '@/lib/artifact-records'
import { useRobloxRecordsStore } from '@/stores/roblox-records-store'
import { useStageStore } from '@/stores/roblox-stage-store'
import { ClothingComposer, revisionPrompt } from './ClothingComposer'

const { mocks } = vi.hoisted(() => ({
  mocks: { runPageGeneration: vi.fn() }
}))

vi.mock('@/lib/roblox-generate', () => ({ runPageGeneration: mocks.runPageGeneration }))

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

function version(type: 'shirt' | 'pants' | 'tshirt') {
  return [{ n: 1, at: 1, prompt: `a ${type}`, ok: true, atlas: 'v1.png', design: { type } }]
}

function renderComposer(current: ArtifactRecord | null = record(), onSettled = vi.fn()) {
  render(<ClothingComposer projectPath="/p" record={current} onSettled={onSettled} />)
  return { onSettled }
}

function typePrompt(text: string): void {
  fireEvent.change(screen.getByLabelText('Describe a garment'), { target: { value: text } })
}

function press(): void {
  fireEvent.click(screen.getByRole('button', { name: /Make it|Apply/ }))
}

interface Run {
  prompt: string
  type: string
  recordSlug?: string
  companions: Array<{ type: string; name: string }>
}

async function lastRun(): Promise<Run> {
  await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalledTimes(1))
  const [options] = mocks.runPageGeneration.mock.calls[0] as [Run]
  return options
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
    useRobloxRecordsStore.setState({
      recordsByProject: {},
      loaded: {},
      atlases: {},
      stills: {},
      reading: {}
    })
    useStageStore.getState().reset('/p')
  })

  it('keeps the only action disabled until something is typed', () => {
    renderComposer()
    expect(screen.getByRole('button', { name: /Apply|Make it/ })).toBeDisabled()
  })

  it('offers one action, so the kind cannot depend on which button was pressed', () => {
    renderComposer()
    typePrompt('x')
    const actions = screen
      .getAllByRole('button')
      .filter((one) => /Apply|Make it/.test(one.textContent ?? ''))
    expect(actions).toHaveLength(1)
  })

  it('generates from the page itself, with no chat involved', async () => {
    renderComposer(null)
    typePrompt('a green tee')
    press()

    const options = await lastRun()
    expect(options.prompt).toBe('a green tee')
    expect(options.type).toBe('shirt')
    expect(options.recordSlug).toBeUndefined()
  })

  it('revises the open record when the picker matches its kind', async () => {
    renderComposer(record({ kind: 'shirt' }))
    typePrompt('thinner stripes')
    expect(screen.getByRole('button', { name: /Apply/ })).toBeInTheDocument()
    press()

    const options = await lastRun()
    expect(options.prompt).toContain('Revise the existing garment')
    expect(options.type).toBe('shirt')
    expect(options.recordSlug).toBe('royal-robe')
  })

  it('makes pants from a page showing a shirt, because the picker decides', async () => {
    // Picking Pants and pressing the action used to revise the shirt under the
    // shirt's kind, so a request for trousers produced another shirt.
    renderComposer(record({ kind: 'shirt', versions: version('shirt') }))
    fireEvent.click(screen.getByRole('button', { name: 'Pants' }))
    typePrompt('celana biru')
    expect(screen.getByRole('button', { name: /Make it/ })).toBeInTheDocument()
    press()

    const options = await lastRun()
    expect(options.type).toBe('pants')
    expect(options.recordSlug).toBeUndefined()
    expect(options.prompt).toBe('celana biru')
  })

  it('sends no outfit by default, because RobloxKit does not either', async () => {
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [
          record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') }),
          record({ slug: 'blue-jeans', kind: 'pants', versions: version('pants') })
        ]
      }
    })
    renderComposer(null)
    typePrompt('celana biru')
    press()

    const options = await lastRun()
    expect(options.companions).toEqual([])
  })

  it('sends the outfit once Match outfit is turned on', async () => {
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [
          record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') }),
          record({ slug: 'blue-jeans', kind: 'pants', versions: version('pants') })
        ]
      }
    })
    renderComposer(null)
    fireEvent.click(screen.getByRole('button', { name: 'Match outfit' }))
    typePrompt('kaos merah')
    press()

    const options = await lastRun()
    // The picker is on Shirt, so the shirt in the project is the kind being made
    // and is left out; the trousers are what the new shirt has to match.
    expect(options.type).toBe('shirt')
    expect(options.companions.map((one) => one.type)).toEqual(['pants'])
  })

  it('matches the shirt on screen when making pants from its page', async () => {
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') })]
      }
    })
    renderComposer(record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') }))
    fireEvent.click(screen.getByRole('button', { name: 'Pants' }))
    fireEvent.click(screen.getByRole('button', { name: 'Match outfit' }))
    typePrompt('celana biru')
    press()

    const options = await lastRun()
    expect(options.companions.map((one) => one.type)).toEqual(['shirt'])
  })

  it('matches the garment on screen, not the newest of its kind', async () => {
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [
          record({ slug: 'kaos-biru-muda', kind: 'shirt', versions: version('shirt') }),
          record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') })
        ]
      }
    })
    renderComposer(record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') }))
    fireEvent.click(screen.getByRole('button', { name: 'Pants' }))
    fireEvent.click(screen.getByRole('button', { name: 'Match outfit' }))
    typePrompt('celana biru')
    press()

    const options = await lastRun()
    expect(options.companions).toHaveLength(1)
    expect(options.companions[0].name).toBe('a shirt')
    expect(options.companions[0].type).toBe('shirt')
  })

  it('can be turned off again, so the next garment is fresh', async () => {
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [record({ slug: 'blue-jeans', kind: 'pants', versions: version('pants') })]
      }
    })
    renderComposer(null)
    const toggle = screen.getByRole('button', { name: 'Match outfit' })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    typePrompt('a red shirt')
    press()

    const options = await lastRun()
    expect(options.companions).toEqual([])
  })

  it('sends nothing at all after New, because fresh means a clean slate', async () => {
    // New clears the record but not the project, so every other garment was still
    // there to be picked up: a fresh pair of trousers came out wearing the shirt.
    useRobloxRecordsStore.setState({
      recordsByProject: {
        '/p': [
          record({ slug: 'royal-robe', kind: 'shirt', versions: version('shirt') }),
          record({ slug: 'blue-jeans', kind: 'pants', versions: version('pants') })
        ]
      }
    })
    render(<ClothingComposer projectPath="/p" record={null} draft onSettled={vi.fn()} />)
    typePrompt('celana tidur')
    press()

    const options = await lastRun()
    expect(options.companions).toEqual([])
  })

  it('keeps the kind the user picked after the open record goes away', async () => {
    const { rerender } = render(
      <ClothingComposer projectPath="/p" record={record({ kind: 'pants' })} />
    )
    expect(screen.getByRole('button', { name: 'Pants' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<ClothingComposer projectPath="/p" record={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shirt' }))
    typePrompt('kemeja army')
    press()

    const options = await lastRun()
    expect(options.type).toBe('shirt')
  })

  it('tells the page to re-read the project once a garment lands', async () => {
    const { onSettled } = renderComposer()
    typePrompt('a hat')
    press()

    await waitFor(() => expect(onSettled).toHaveBeenCalled())
  })

  it('clears the field after a garment lands', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    typePrompt('a green tee')
    press()

    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('shows why a generation failed instead of pretending it worked', async () => {
    mocks.runPageGeneration.mockResolvedValue({ status: 'failed', error: 'the model ran out' })
    renderComposer()
    typePrompt('a hat')
    press()

    expect(await screen.findByText('the model ran out')).toBeInTheDocument()
  })

  it('keeps the prompt when the generation was cancelled', async () => {
    mocks.runPageGeneration.mockResolvedValue({ status: 'cancelled' })
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    typePrompt('a hat')
    press()

    await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalled())
    expect(field).toHaveValue('a hat')
  })

  it('sends on Enter', async () => {
    renderComposer()
    const field = screen.getByLabelText('Describe a garment')
    typePrompt('a green tee')
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() => expect(mocks.runPageGeneration).toHaveBeenCalledTimes(1))
  })

  it('finishes the stage even after the page was left mid-draw', async () => {
    // Leaving the page used to strand the stage in "running", so coming back
    // showed "drawing" over a garment already on disk.
    let finish: ((outcome: unknown) => void) | null = null
    mocks.runPageGeneration.mockImplementation(
      () => new Promise((resolve) => (finish = resolve as (outcome: unknown) => void))
    )
    const { unmount } = render(
      <ClothingComposer projectPath="/p" record={record()} onSettled={vi.fn()} />
    )
    typePrompt('a hat')
    press()
    await waitFor(() => expect(useStageStore.getState().byProject['/p']?.state).toBe('running'))

    unmount()
    finish?.({
      status: 'done',
      saved: { slug: 'a-hat', version: 1, path: '/p/a.png', relative: 'a.png', itemPath: '/p/i' }
    })

    await waitFor(() => expect(useStageStore.getState().byProject['/p']?.state).toBe('done'))
  })
})
