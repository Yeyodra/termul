import { describe, expect, it, vi } from 'vitest'
import type { GeneratorCall } from '@/lib/acp-transport/generator-gateway-client'
import { CLOTHING_SYSTEM_PROMPT } from '@/lib/generator/engines/clothing'
import { buildClothing } from '@/lib/generator/engines/clothing/build'
import { createGeneratorHandler } from '@/lib/generator/gateway-handler'
import { TaskQueue } from '@/lib/generator/task-queue'
import type { ClothingToolDeps } from '@/lib/generator/tools/generate-clothing'
import type { Brain } from '@/lib/generator/types'

function call(tool: string, args: Record<string, unknown> = {}): GeneratorCall {
  return {
    agentId: 'claude',
    sessionId: 's-1',
    callId: 1,
    tool,
    arguments: JSON.stringify(args)
  }
}

function harness() {
  const queue = new TaskQueue()
  const brain: Brain = { id: 'claude' }
  const clothing: ClothingToolDeps = {
    queue,
    brain,
    askBrain: vi.fn(
      async () => '```json\n{"type":"shirt","layers":[{"kind":"solid","color":"#112233"}]}\n```'
    ),
    brainTakesImages: async () => false,
    system: CLOTHING_SYSTEM_PROMPT
  }
  return { handler: createGeneratorHandler({ queue, clothing }), queue, clothing }
}

describe('createGeneratorHandler', () => {
  it('queues a clothing generation and returns its task id at once', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_clothing', { type: 'shirt', prompt: 'striped' }))

    expect(reply.ok).toBe(true)
    expect(reply.callId).toBe(1)
    expect(reply.result).toMatchObject({ status: expect.stringMatching(/queued|running/) })
    expect((reply.result as { taskId: string }).taskId).toBeTruthy()
  })

  it('rejects a missing or unknown garment type with a message the agent can act on', async () => {
    const { handler } = harness()

    const missing = await handler(call('generate_clothing', {}))
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('"shirt", "pants" or "tshirt"')
    expect(missing.error).toContain('not read from inside `spec`')

    const unknown = await handler(call('generate_clothing', { type: 'hoodie' }))
    expect(unknown.ok).toBe(false)
  })

  it('accepts the garment type from inside a spec, so a reasonable guess still works', async () => {
    const { handler } = harness()

    const reply = await handler(
      call('generate_clothing', { spec: { type: 'pants', layers: [{ kind: 'solid' }] } })
    )

    expect(reply.ok).toBe(true)
  })

  it('reports an unknown task id instead of throwing', async () => {
    const { handler } = harness()

    const reply = await handler(call('get_clothing_task', { task_id: 'nope' }))

    expect(reply.ok).toBe(true)
    expect(reply.result).toMatchObject({ status: 'failed', taskId: 'nope' })
  })

  it('needs a task_id to read a task', async () => {
    const { handler } = harness()

    const reply = await handler(call('get_clothing_task', {}))

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('task_id')
  })

  it('names the missing engine instead of pretending every family works', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_3d', { prompt: 'a car' }))

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('no engine in this build')
    expect(reply.error).toContain('generate_3d')
  })

  it('refuses a tool this window does not serve at all', async () => {
    const { handler } = harness()

    const reply = await handler(call('execute_luau', { code: 'return 1' }))

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('not a generator tool')
  })

  it('refuses arguments that are not a JSON object', async () => {
    const { handler } = harness()

    const reply = await handler({ ...call('generate_clothing'), arguments: '[1,2]' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('JSON object')
  })

  it('runs a queued generation through the engine to a rendered result', async () => {
    const { handler, queue, clothing } = harness()
    const accepted = await handler(call('generate_clothing', { type: 'shirt', prompt: 'navy' }))
    const taskId = (accepted.result as { taskId: string }).taskId

    await vi.waitFor(
      () => {
        expect(queue.get(taskId)?.status).toBe('done')
      },
      { timeout: 5000 }
    )

    const polled = await handler(call('get_clothing_task', { task_id: taskId }))
    expect(polled.ok).toBe(true)
    expect(polled.result).toMatchObject({ status: 'done', taskId })
    expect(clothing.askBrain).toHaveBeenCalled()
  })

  it('renders the same spec to the same bytes, so a rebuild is verifiable', async () => {
    const design = {
      type: 'shirt' as const,
      layers: [{ kind: 'stripes', color: '#ffffff', color2: '#112233', size: 8, gap: 24 }]
    }

    const first = await buildClothing(design, { type: 'shirt' })
    const second = await buildClothing(design, { type: 'shirt' })

    expect(first.report.ok).toBe(true)
    expect(second.sheet).toEqual(first.sheet)
  })
})
