import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pollPageGeneration,
  runPageGeneration,
  saveArtifact,
  startPageGeneration
} from './roblox-generate'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    pageGenerator: vi.fn(),
    queueGenerateClothing: vi.fn(),
    readClothingResult: vi.fn(),
    invoke: vi.fn(),
    isTauri: { value: true },
    refreshLoadedProjects: vi.fn()
  }
}))

vi.mock('@/lib/generator-gateway', () => ({ pageGenerator: mocks.pageGenerator }))
vi.mock('@/lib/generator/tools/generate-clothing', () => ({
  queueGenerateClothing: mocks.queueGenerateClothing,
  readClothingResult: mocks.readClothingResult
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/tauri-runtime', () => ({ isTauriContext: () => mocks.isTauri.value }))
vi.mock('@/stores/roblox-records-store', () => ({
  refreshLoadedProjects: mocks.refreshLoadedProjects
}))

const DEPS = { queue: {}, clothing: { marker: 'clothing-deps' } }

describe('startPageGeneration', () => {
  beforeEach(() => {
    mocks.pageGenerator.mockReset()
    mocks.queueGenerateClothing.mockReset()
  })

  it('says so when the engine is not ready, instead of throwing', () => {
    mocks.pageGenerator.mockReturnValue(null)
    expect(startPageGeneration({ projectPath: '/p', prompt: 'x', type: 'shirt' })).toEqual({
      status: 'unavailable',
      reason: 'the generator engine is not ready yet'
    })
  })

  it('queues on the same deps the agent path uses', () => {
    mocks.pageGenerator.mockReturnValue(DEPS)
    mocks.queueGenerateClothing.mockReturnValue({ taskId: 'task-1', status: 'queued' })

    expect(startPageGeneration({ projectPath: '/p', prompt: 'a tee', type: 'shirt' })).toEqual({
      status: 'queued',
      taskId: 'task-1'
    })
    expect(mocks.queueGenerateClothing).toHaveBeenCalledWith(DEPS.clothing, {
      type: 'shirt',
      prompt: 'a tee'
    })
  })
})

describe('pollPageGeneration', () => {
  beforeEach(() => {
    mocks.pageGenerator.mockReset()
    mocks.readClothingResult.mockReset()
  })

  it('reports a failure when the engine stopped', () => {
    mocks.pageGenerator.mockReturnValue(null)
    expect(pollPageGeneration('task-1')).toMatchObject({ status: 'failed' })
  })

  it('reads the task through the same queue', () => {
    mocks.pageGenerator.mockReturnValue(DEPS)
    mocks.readClothingResult.mockReturnValue({ status: 'running', taskId: 'task-1', stage: 'Draw' })
    expect(pollPageGeneration('task-1')).toMatchObject({ status: 'running' })
    expect(mocks.readClothingResult).toHaveBeenCalledWith(DEPS.queue, 'task-1')
  })
})

describe('saveArtifact', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.refreshLoadedProjects.mockReset()
    mocks.isTauri.value = true
  })

  it('writes through the host command and refreshes the collection', async () => {
    const saved = {
      slug: 'green-tee',
      version: 1,
      path: '/p/a.png',
      relative: 'a.png',
      itemPath: '/p/i.json'
    }
    mocks.invoke.mockResolvedValue(saved)

    expect(await saveArtifact('/p', { status: 'done', taskId: 't', stage: 'Done' })).toEqual(saved)
    expect(mocks.invoke).toHaveBeenCalledWith('save_artifact', {
      projectPath: '/p',
      result: expect.objectContaining({ status: 'done' })
    })
    expect(mocks.refreshLoadedProjects).toHaveBeenCalled()
  })

  it('refuses on the web client, where there is no binary write path', async () => {
    mocks.isTauri.value = false
    await expect(
      saveArtifact('/p', { status: 'done', taskId: 't', stage: 'Done' })
    ).rejects.toThrow(/desktop-only/)
  })
})

describe('runPageGeneration', () => {
  beforeEach(() => {
    mocks.pageGenerator.mockReturnValue(DEPS)
    mocks.queueGenerateClothing.mockReturnValue({ taskId: 'task-1', status: 'queued' })
    mocks.readClothingResult.mockReset()
    mocks.invoke.mockReset()
    mocks.isTauri.value = true
  })

  it('polls to done, then saves what came out', async () => {
    mocks.readClothingResult
      .mockReturnValueOnce({ status: 'running', taskId: 'task-1', stage: 'Draw' })
      .mockReturnValueOnce({ status: 'done', taskId: 'task-1', stage: 'Done', atlas: 'data:x' })
    const saved = {
      slug: 'green-tee',
      version: 1,
      path: '/p/a.png',
      relative: 'a.png',
      itemPath: '/p/i.json'
    }
    mocks.invoke.mockResolvedValue(saved)

    const stages: string[] = []
    const outcome = await runPageGeneration({
      projectPath: '/p',
      prompt: 'a tee',
      type: 'shirt',
      onStage: (stage) => stages.push(stage)
    })

    expect(outcome).toEqual({ status: 'done', saved })
    expect(stages).toContain('Draw')
  })

  it('surfaces a failed generation with its message', async () => {
    mocks.readClothingResult.mockReturnValue({
      status: 'failed',
      taskId: 'task-1',
      stage: 'Draw',
      error: 'the model refused'
    })
    expect(await runPageGeneration({ projectPath: '/p', prompt: 'x', type: 'shirt' })).toEqual({
      status: 'failed',
      error: 'the model refused'
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('reports a cancelled generation as cancelled, not as a failure', async () => {
    mocks.readClothingResult.mockReturnValue({
      status: 'cancelled',
      taskId: 'task-1',
      stage: 'Draw'
    })
    expect(await runPageGeneration({ projectPath: '/p', prompt: 'x', type: 'shirt' })).toEqual({
      status: 'cancelled'
    })
  })

  it('reports a save failure without claiming the garment landed', async () => {
    mocks.readClothingResult.mockReturnValue({
      status: 'done',
      taskId: 'task-1',
      stage: 'Done',
      atlas: 'data:x'
    })
    mocks.invoke.mockRejectedValue(new Error('not a registered project'))

    expect(await runPageGeneration({ projectPath: '/p', prompt: 'x', type: 'shirt' })).toEqual({
      status: 'failed',
      error: 'not a registered project'
    })
  })

  it('reports an unavailable engine instead of hanging', async () => {
    mocks.pageGenerator.mockReturnValue(null)
    expect(await runPageGeneration({ projectPath: '/p', prompt: 'x', type: 'shirt' })).toEqual({
      status: 'failed',
      error: 'the generator engine is not ready yet'
    })
  })
})
