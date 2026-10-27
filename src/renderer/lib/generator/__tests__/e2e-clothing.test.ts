/**
 * The whole chain: agent calls the tool, gets a task id, the loop runs against a
 * stub brain, the engine renders, and the poll returns an artifact.
 *
 * This is the only test that covers every layer at once, so it is the one that
 * proves A-E actually connect.
 */
import { describe, expect, it } from 'vitest'
import { createAskBrain, createBrainTakesImages } from '@/lib/generator/ask-brain'
import { sessionContext } from '@/lib/generator/session-context'
import { TaskQueue } from '@/lib/generator/task-queue'
import {
  type ClothingToolDeps,
  firstMessage,
  GENERATE_CLOTHING_INPUT_SCHEMA,
  queueGenerateClothing,
  readClothingResult
} from '@/lib/generator/tools/generate-clothing'
import type { Brain, BrainRequest } from '@/lib/generator/types'

const DESIGN = {
  type: 'shirt',
  layers: [
    { kind: 'solid', target: 'all', color: '#1f2a44' },
    {
      kind: 'stripes',
      target: 'torso',
      color: '#ffffff',
      color2: '#1f2a44',
      size: 6,
      gap: 26,
      angle: 90
    }
  ]
}

const brain: Brain = { id: 'claude', scope: 'gen/clothing' }

/** A transport that replies with a scripted sequence and records the traffic. */
function scriptedTransport(replies: string[]) {
  const sent: Array<{
    scope: string
    system: string
    messages: Array<{ role: string; text: string }>
  }> = []
  return {
    sent,
    transport: {
      send: async (request: {
        scope: string
        system: string
        messages: Array<{ role: 'user' | 'assistant'; text: string }>
      }) => {
        sent.push(request)
        const reply = replies.shift()
        if (reply === undefined) throw new Error('no reply left')
        return reply
      }
    }
  }
}

function deps(overrides: Partial<ClothingToolDeps> = {}): ClothingToolDeps {
  const { transport } = scriptedTransport([])
  return {
    queue: new TaskQueue(),
    brain,
    askBrain: createAskBrain({ transport }),
    brainTakesImages: createBrainTakesImages(() => false),
    system: 'You design Roblox clothing.',
    ...overrides
  }
}

describe('generate_clothing tool contract', () => {
  it('declares the schema the agent reads', () => {
    expect(GENERATE_CLOTHING_INPUT_SCHEMA.required).toEqual(['type'])
    expect(GENERATE_CLOTHING_INPUT_SCHEMA.properties.type.enum).toEqual([
      'shirt',
      'pants',
      'tshirt'
    ])
  })

  it('puts the Studio context first in the first message', () => {
    const message = firstMessage(
      { type: 'shirt', prompt: 'a racing jacket' },
      { studios: [{ id: 's1', name: 'My Obby' }], studioId: 's1', status: 'connected' }
    )

    expect(message.text.startsWith('Robloxkit session context')).toBe(true)
    expect(message.text).toContain('Open place: My Obby')
    expect(message.text).toContain('Design a shirt: a racing jacket')
  })

  it('asks for a correction when a design is supplied', () => {
    const message = firstMessage({ type: 'shirt', design: DESIGN })
    expect(message.text).toContain('Fix this shirt design JSON')
    expect(message.text).toContain('"kind": "solid"')
  })

  it('omits the context block when no Studio is attached', () => {
    const message = firstMessage({ type: 'shirt', prompt: 'x' })
    expect(message.text).not.toContain('Robloxkit session context')
  })
})

describe('generate_clothing end to end', () => {
  it('returns a task id immediately, then a rendered artifact on poll', async () => {
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(DESIGN)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()
    const toolDeps = deps({
      queue,
      askBrain: createAskBrain({ transport })
    })

    const accepted = queueGenerateClothing(toolDeps, { type: 'shirt', prompt: 'a racing jacket' })

    expect(accepted.taskId).toMatch(/^task-/)
    expect(accepted.note).toContain('get_task_result')

    await queue.drain()

    const polled = readClothingResult(queue, accepted.taskId)
    expect(polled.status).toBe('done')
    expect(polled.summary).toContain('ready')

    const outcome = polled.result as {
      result: { type: string }
      built: { report: { ok: boolean } }
    }
    expect(outcome.result.type).toBe('shirt')
    expect(outcome.built.report.ok).toBe(true)

    expect(sent).toHaveLength(2)
    expect(sent[0].scope).toBe('gen/clothing')
    expect(sent[0].messages[0].text).toContain('Design a shirt: a racing jacket')
  })

  it('sends the system prompt folded into the first turn for a non-ACP brain', async () => {
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(DESIGN)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    queueGenerateClothing(
      deps({
        queue,
        brain: { id: 'custom' },
        askBrain: createAskBrain({ transport })
      }),
      { type: 'shirt', prompt: 'x' }
    )
    await queue.drain()

    expect(sent[0].messages[0].text.startsWith('You design Roblox clothing.')).toBe(true)
  })

  it('recovers from a rejected design by echoing the problems back', async () => {
    const bad = { type: 'shirt', layers: [{ kind: 'solid', color: 'nope', target: 'all' }] }
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``,
      `\`\`\`json\n${JSON.stringify(DESIGN)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    const accepted = queueGenerateClothing(
      deps({ queue, askBrain: createAskBrain({ transport }) }),
      { type: 'shirt', prompt: 'a racing jacket' }
    )
    await queue.drain()

    const polled = readClothingResult(queue, accepted.taskId)
    expect(polled.status).toBe('done')

    const echoed = sent[1].messages[sent[1].messages.length - 1].text
    expect(echoed).toContain('The engine rejected the design')
    expect(echoed).toContain('layers[0].color: "nope" is not a #rrggbb colour')
  })

  it('fails the task when the model never produces a usable design', async () => {
    const { transport } = scriptedTransport(['no json', 'no json', 'no json', 'no json', 'no json'])
    const queue = new TaskQueue()

    const accepted = queueGenerateClothing(
      deps({ queue, askBrain: createAskBrain({ transport }) }),
      { type: 'shirt', prompt: 'x' }
    )
    await queue.drain()

    const polled = readClothingResult(queue, accepted.taskId)
    expect(polled.status).toBe('failed')
    expect(polled.error).toContain('could not be built')
  })

  it('reports an unknown task id rather than throwing', () => {
    const queue = new TaskQueue()
    const polled = readClothingResult(queue, 'task-nope')

    expect(polled.status).toBe('failed')
    expect(polled.error).toContain('No task task-nope')
  })

  it('cancels a queued generation without finishing it', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new TaskQueue({ concurrency: 1 })

    let calls = 0
    const toolDeps = deps({
      queue,
      askBrain: async () => {
        calls += 1
        if (calls === 1) await gate
        return calls === 1 ? 'DONE' : '```json\n{}\n```'
      }
    })

    queueGenerateClothing(toolDeps, { type: 'shirt', prompt: 'first' })
    const second = queueGenerateClothing(toolDeps, { type: 'pants', prompt: 'second' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(queue.get(second.taskId)?.status).toBe('queued')
    expect(queue.cancel(second.taskId)).toBe(true)

    release?.()
    await queue.drain()

    expect(readClothingResult(queue, second.taskId).status).toBe('cancelled')
  })

  it('carries the live Studio state into the prompt', async () => {
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(DESIGN)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    queueGenerateClothing(
      deps({
        queue,
        askBrain: createAskBrain({ transport }),
        studio: { studios: [{ id: 's1', name: 'My Obby' }], studioId: 's1', status: 'connected' }
      }),
      { type: 'shirt', prompt: 'x' }
    )
    await queue.drain()

    expect(sent[0].messages[0].text).toContain(
      sessionContext({
        studios: [{ id: 's1', name: 'My Obby' }],
        studioId: 's1',
        status: 'connected'
      })
    )
  })
})

describe('askBrain', () => {
  it('folds the system prompt into the first turn for every agent', async () => {
    const history = [{ role: 'user' as const, text: 'hi' }]
    const { transport, sent } = scriptedTransport(['ok'])
    const ask = createAskBrain({ transport })

    await ask({ brain: { id: 'claude' }, history, system: 'SYS' })

    expect(sent[0].messages[0].text).toBe('SYS\n\n---\n\nhi')
  })

  it('folds the prompt for a non-Claude agent too, because every agent here is ACP', async () => {
    const { transport, sent } = scriptedTransport(['ok'])
    const ask = createAskBrain({ transport })

    await ask({
      brain: { id: 'codex' },
      history: [{ role: 'user', text: 'hi' }],
      system: 'SYS'
    })

    expect(sent[0].messages[0].text).toBe('SYS\n\n---\n\nhi')
  })

  it('leaves the first turn alone when there is no system prompt', async () => {
    const { transport, sent } = scriptedTransport(['ok'])
    const ask = createAskBrain({ transport })

    await ask({ brain: { id: 'claude' }, history: [{ role: 'user', text: 'hi' }], system: '  ' })

    expect(sent[0].messages[0].text).toBe('hi')
  })

  it('scopes the session by action when the brain has none', async () => {
    const { transport, sent } = scriptedTransport(['ok'])
    const ask = createAskBrain({ transport })

    await ask({
      brain: { id: 'claude' },
      history: [{ role: 'user', text: 'x' }],
      system: 'SYS',
      action: 'clothing'
    })

    expect(sent[0].scope).toBe('gen/clothing')
  })

  it('reports the phase before sending', async () => {
    const { transport } = scriptedTransport(['ok'])
    const phases: string[] = []
    const ask = createAskBrain({ transport })

    await ask({
      brain: { id: 'claude' },
      history: [{ role: 'user', text: 'x' }],
      system: 'SYS',
      onPhase: (phase) => phases.push(phase)
    })

    expect(phases[0]).toContain('asking')
  })
})

describe('brainTakesImages', () => {
  it('reports what the agent advertised, never what its name suggests', async () => {
    const takes = createBrainTakesImages()

    expect(await takes({ id: 'claude', takesImages: true })).toBe(true)
    expect(await takes({ id: 'claude', takesImages: false })).toBe(false)
    expect(await takes({ id: 'codex', takesImages: true })).toBe(true)
  })

  it('treats an unknown capability as no, so the loop does not pay a retry', async () => {
    const takes = createBrainTakesImages()

    expect(await takes({ id: 'claude' })).toBe(false)
    expect(await takes({ id: 'custom' })).toBe(false)
  })
})

describe('task queue integration', () => {
  it('never blocks the caller while a generation runs', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queue = new TaskQueue()
    const slow: BrainRequest[] = []

    const accepted = queueGenerateClothing(
      deps({
        queue,
        askBrain: async (request) => {
          slow.push(request)
          await gate
          return 'DONE'
        }
      }),
      { type: 'shirt', prompt: 'slow' }
    )

    expect(accepted.taskId).toMatch(/^task-/)
    expect(slow).toHaveLength(1)

    release?.()
    await queue.drain()
    expect(readClothingResult(queue, accepted.taskId).status).toBe('failed')
  })
})
