import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactRecord } from '@/lib/artifact-records'
import { useStageStore } from '@/stores/roblox-stage-store'
import { ModelComposer } from './ModelComposer'

const { mocks } = vi.hoisted(() => ({
  mocks: { runModelGeneration: vi.fn() }
}))

vi.mock('@/lib/roblox-generate-3d', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roblox-generate-3d')>(
    '@/lib/roblox-generate-3d'
  )
  return { ...actual, runModelGeneration: mocks.runModelGeneration }
})

function record(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    slug: 'treasure-chest',
    kind: 'prop',
    current: 2,
    createdAt: 1,
    updatedAt: 1,
    dir: '/p/.termul/generated/prop/treasure-chest',
    itemPath: '/p/.termul/generated/prop/treasure-chest/item.json',
    versions: [
      { n: 1, at: 1, prompt: 'a chest', ok: true, atlas: 'v1.glb', model: 'v1.glb' },
      { n: 2, at: 2, prompt: 'a big chest', ok: true, atlas: 'v2.glb', model: 'v2.glb' }
    ],
    ...overrides
  }
}

function renderComposer(current: ArtifactRecord | null = null, onSettled = vi.fn()) {
  render(<ModelComposer projectPath="/p" record={current} onSettled={onSettled} />)
  return { onSettled }
}

function typePrompt(text: string): void {
  fireEvent.change(screen.getByLabelText('Describe a model'), { target: { value: text } })
}

function press(): void {
  fireEvent.click(screen.getByRole('button', { name: /Make it|Apply/ }))
}

interface Run {
  prompt: string
  category: string
  rig?: string
  recordSlug?: string
  base?: unknown
}

async function lastRun(): Promise<Run> {
  await waitFor(() => expect(mocks.runModelGeneration).toHaveBeenCalled())
  return mocks.runModelGeneration.mock.calls.at(-1)![0] as Run
}

describe('the 3D composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runModelGeneration.mockResolvedValue({
      status: 'done',
      saved: {
        slug: 'treasure-chest',
        kind: 'prop',
        version: 3,
        path: '/p/.termul/generated/prop/treasure-chest/v3.glb',
        relative: 'prop/treasure-chest/v3.glb',
        itemPath: '/p/.termul/generated/prop/treasure-chest/item.json'
      }
    })
  })

  it('exists at all, which is what the 3D page was missing', () => {
    renderComposer()
    expect(screen.getByLabelText('Describe a model')).toBeInTheDocument()
  })

  it('offers every category the engine accepts', () => {
    renderComposer()
    for (const label of ['Prop', 'Building', 'Tool', 'Character']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('will not send an empty prompt', () => {
    renderComposer()
    expect(screen.getByRole('button', { name: /Make it/ })).toBeDisabled()
  })

  it('makes a new model of the picked category', async () => {
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Building' }))
    typePrompt('a small apartment block')
    press()

    const run = await lastRun()
    expect(run.prompt).toBe('a small apartment block')
    expect(run.category).toBe('building')
    expect(run.recordSlug).toBeUndefined()
  })

  it('revises the open model instead of making a second one', async () => {
    renderComposer(record())
    typePrompt('thicker lid')

    expect(screen.getByRole('button', { name: /Apply/ })).toBeInTheDocument()
    press()

    const run = await lastRun()
    // The slug is a fact passed to the host, not an appeal in the prompt: a
    // renamed model used to land as a second record with an empty history.
    expect(run.recordSlug).toBe('treasure-chest')
    expect(run.prompt).toContain('treasure-chest')
    expect(run.prompt).toContain('thicker lid')
  })

  it('keeps the record category when the picker says otherwise', async () => {
    renderComposer(record())
    fireEvent.click(screen.getByRole('button', { name: 'Character' }))
    typePrompt('turn it into a character')
    press()

    const run = await lastRun()
    // The host files a record by its kind, so a revision that took the picker's
    // category wrote a second record under a different folder instead of a new
    // version, and the original history stopped at the previous version.
    expect(run.recordSlug).toBe('treasure-chest')
    expect(run.category).toBe('prop')
  })

  it('lets the picker choose the category for a new model', async () => {
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Character' }))
    typePrompt('a knight')
    press()

    const run = await lastRun()
    expect(run.category).toBe('character')
  })

  it('rigs a creature even when the picker says prop, and says so', async () => {
    renderComposer()
    typePrompt('a brown puppy')
    press()

    const run = await lastRun()
    // A dog built as a prop has no skeleton and no leg proportions, so it comes
    // out as boxes. The prompt is a better signal than the picker here.
    expect(run.category).toBe('character')
    expect(await screen.findByText(/rigged character/)).toBeInTheDocument()
  })

  it('sends the creature its own rig, not the humanoid default', async () => {
    renderComposer()
    typePrompt('a brown puppy')
    press()

    const run = await lastRun()
    // Unset, the engine assumes R15, and a quadruped came back with a humanoid
    // rig and an empty skeleton.
    expect(run.rig).toBe('custom')
  })

  it('sends R15 for a person, which is the rig the engine expects', async () => {
    renderComposer()
    typePrompt('a knight')
    press()

    const run = await lastRun()
    expect(run.rig).toBe('R15')
  })

  it('keeps a statue of a creature a prop', async () => {
    renderComposer()
    typePrompt('a dragon statue')
    press()

    const run = await lastRun()
    expect(run.category).toBe('prop')
  })

  it('leaves an ordinary prop on the picked category, without a notice', async () => {
    renderComposer()
    typePrompt('a wooden crate')
    press()

    const run = await lastRun()
    expect(run.category).toBe('prop')
    expect(screen.queryByText(/rigged character/)).toBeNull()
  })

  it('names the model on screen in the placeholder, so Revise is unambiguous', () => {
    renderComposer(record())
    expect(screen.getByLabelText('Describe a model')).toHaveAttribute(
      'placeholder',
      expect.stringContaining('a big chest')
    )
  })

  it('hands the engine the stored spec, so a revision keeps everything else', async () => {
    const base = { version: 1, name: 'Chest', category: 'prop', parts: [] }
    renderComposer(
      record({
        current: 1,
        versions: [
          {
            n: 1,
            at: 1,
            prompt: 'a chest',
            ok: true,
            atlas: 'v1.glb',
            model: 'v1.glb',
            design: base
          }
        ]
      })
    )
    typePrompt('thicker lid')
    press()

    const run = await lastRun()
    // Without the base the engine has nothing to keep "everything else" of and
    // re-invents the model from the prompt alone.
    expect(run.base).toEqual(base)
  })

  it('sends no base when making a new model, so it is not a revision', async () => {
    renderComposer()
    typePrompt('a crate')
    press()

    const run = await lastRun()
    expect(run.base).toBeUndefined()
  })

  it('clears the box and hands back the slug that was written', async () => {
    const { onSettled } = renderComposer()
    typePrompt('a crate')
    press()

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('treasure-chest', 'prop'))
    expect(screen.getByLabelText('Describe a model')).toHaveValue('')
  })

  it('sends on Enter, without the Make button', async () => {
    renderComposer()
    typePrompt('a barrel')
    fireEvent.keyDown(screen.getByLabelText('Describe a model'), { key: 'Enter' })

    const run = await lastRun()
    expect(run.prompt).toBe('a barrel')
  })

  it('shows the reason a generation failed instead of looking stuck', async () => {
    mocks.runModelGeneration.mockResolvedValue({
      status: 'failed',
      error: 'no ACP agent is running'
    })
    renderComposer()
    typePrompt('a barrel')
    press()

    expect(await screen.findByText('no ACP agent is running')).toBeInTheDocument()
    // The prompt stays so the user can retry it rather than retyping.
    expect(screen.getByLabelText('Describe a model')).toHaveValue('a barrel')
  })

  it('leaves the stage idle when the run was cancelled', async () => {
    mocks.runModelGeneration.mockResolvedValue({ status: 'cancelled' })
    renderComposer()
    typePrompt('a barrel')
    press()

    await waitFor(() => expect(useStageStore.getState().byProject['/p']?.state).toBe('idle'))
  })
})
