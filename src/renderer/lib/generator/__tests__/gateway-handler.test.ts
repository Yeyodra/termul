import { describe, expect, it, vi } from 'vitest'
import type { GeneratorCall } from '@/lib/acp-transport/generator-gateway-client'
import { MODEL_3D_SYSTEM_PROMPT } from '@/lib/generator/engines/3d'
import { CLOTHING_SYSTEM_PROMPT } from '@/lib/generator/engines/clothing'
import { buildClothing } from '@/lib/generator/engines/clothing/build'
import { createGeneratorHandler } from '@/lib/generator/gateway-handler'
import { TaskQueue } from '@/lib/generator/task-queue'
import type { Model3DToolDeps } from '@/lib/generator/tools/generate-3d'
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

/** A complete, valid spec, so the 3D path builds without asking the brain twice. */
const VALID_SPEC = {
  version: 1,
  name: 'Crate',
  category: 'prop',
  palette: { wood: '#8a5a32' },
  parts: [{ type: 'box', size: [2, 2, 2], color: 'wood' }]
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
  const model3d: Model3DToolDeps = {
    queue,
    brain,
    askBrain: vi.fn(async () => `\`\`\`json\n${JSON.stringify(VALID_SPEC)}\n\`\`\``),
    brainTakesImages: async () => false,
    system: MODEL_3D_SYSTEM_PROMPT
  }
  return {
    handler: createGeneratorHandler({ queue, clothing, model3d }),
    queue,
    clothing,
    model3d
  }
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

  it('carries record_slug through, so an agent can revise a garment', async () => {
    const { handler, queue } = harness()

    await handler(
      call('generate_clothing', {
        type: 'shirt',
        prompt: 'make it purple',
        record_slug: 'baju-tentara-perang'
      })
    )

    const task = queue.get((queue.list()[0] ?? { id: '' }).id)
    expect((task?.params as { recordSlug?: string } | undefined)?.recordSlug).toBe(
      'baju-tentara-perang'
    )
  })

  it('leaves record_slug absent for a fresh garment', async () => {
    const { handler, queue } = harness()

    await handler(call('generate_clothing', { type: 'shirt', prompt: 'a new shirt' }))

    const task = queue.get((queue.list()[0] ?? { id: '' }).id)
    expect((task?.params as { recordSlug?: string } | undefined)?.recordSlug).toBeUndefined()
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

  it('names a still-missing engine instead of pretending every family works', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_sfx', { prompt: 'a door' }))

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('no engine in this build')
    expect(reply.error).toContain('generate_sfx')
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

describe('the 3D engine', () => {
  it('no longer refuses generate_3d', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_3d', { prompt: 'a crate', category: 'prop' }))

    expect(reply.ok).toBe(true)
    expect(reply.error).toBeUndefined()
  })

  it('queues a 3D generation and returns its task id at once', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_3d', { prompt: 'a crate', category: 'prop' }))
    const result = reply.result as { taskId: string; status: string; note: string }

    expect(result.taskId).toBeTruthy()
    expect(result.status).toMatch(/queued|running/)
    // The note must name the poll tool that actually exists.
    expect(result.note).toContain('get_3d_task')
  })

  it('polls a 3D task from queued to done', async () => {
    const { handler, queue } = harness()

    const accepted = await handler(call('generate_3d', { prompt: 'a crate', category: 'prop' }))
    const taskId = (accepted.result as { taskId: string }).taskId

    // Let the queued task run to completion.
    await vi.waitFor(() => expect(queue.get(taskId)?.status).toBe('done'), { timeout: 10000 })

    const polled = await handler(call('get_3d_task', { task_id: taskId }))
    expect(polled.ok).toBe(true)
    const result = polled.result as {
      status: string
      spec: { category: string }
      model?: string
      report: { ok: boolean; triangles: number }
    }

    expect(result.status).toBe('done')
    expect(result.spec.category).toBe('prop')
    // The GLB is the artifact the host writes and the viewport reads.
    expect(result.model).toMatch(/^data:model\/gltf-binary;base64,/)
    expect(result.report.ok).toBe(true)
    expect(result.report.triangles).toBeGreaterThan(0)
  })

  it('needs a task_id to poll', async () => {
    const { handler } = harness()
    const reply = await handler(call('get_3d_task', {}))
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('task_id')
  })

  it('rejects an unknown category with a message the agent can act on', async () => {
    const { handler } = harness()
    const reply = await handler(call('generate_3d', { prompt: 'a gun', category: 'weapon' }))

    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('category')
    expect(reply.error).toContain('accessory, prop, building, tool, text, character')
  })

  it('defaults the category to prop when neither the call nor the spec names one', async () => {
    const { handler, queue } = harness()

    const accepted = await handler(call('generate_3d', { prompt: 'a crate' }))
    const taskId = (accepted.result as { taskId: string }).taskId
    await vi.waitFor(() => expect(queue.get(taskId)?.status).toBe('done'), { timeout: 10000 })

    const polled = await handler(call('get_3d_task', { task_id: taskId }))
    expect((polled.result as { spec: { category: string } }).spec.category).toBe('prop')
  })

  it('reads the category from a spec when the call does not name one', async () => {
    const { handler, queue } = harness()
    const spec = { ...VALID_SPEC, category: 'building' }

    const accepted = await handler(call('generate_3d', { prompt: 'a wall', spec }))
    const taskId = (accepted.result as { taskId: string }).taskId
    await vi.waitFor(() => expect(queue.get(taskId)?.status).toBe('done'), { timeout: 10000 })

    const polled = await handler(call('get_3d_task', { task_id: taskId }))
    expect((polled.result as { spec: { category: string } }).spec.category).toBe('building')
  })

  it('needs a prompt or a spec', async () => {
    const { handler } = harness()
    const reply = await handler(call('generate_3d', { category: 'prop' }))
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('prompt')
  })

  it('still serves generate_clothing, so the second engine is not a regression', async () => {
    const { handler } = harness()

    const reply = await handler(call('generate_clothing', { type: 'shirt', prompt: 'striped' }))

    expect(reply.ok).toBe(true)
    expect((reply.result as { note: string }).note).toContain('get_clothing_task')
  })
})
