/**
 * The whole chain, end to end: agent calls the tool, gets a task id, the loop
 * runs against a stub brain, the 3D engine builds and exports, and the poll
 * comes back with a spec, a review sheet and a GLB.
 *
 * This is the 3D counterpart of `e2e-clothing.test.ts`: one file covers every
 * layer, so it is the test that proves the engine is actually wired rather than
 * merely type-checking. It guards the failure modes a unit test cannot see: an
 * agent that guesses a field name, a brain that rejects the image, and a build
 * that lets an invalid spec through.
 */
import { describe, expect, it } from 'vitest'
import { createAskBrain, createBrainTakesImages } from '@/lib/generator/ask-brain'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import { sessionContext } from '@/lib/generator/session-context'
import { TaskQueue } from '@/lib/generator/task-queue'
import {
  firstModelMessage,
  GENERATE_3D_INPUT_SCHEMA,
  type Model3DToolDeps,
  modelReview,
  queueGenerate3D,
  readModelResult
} from '@/lib/generator/tools/generate-3d'
import type { Brain, BuildResult } from '@/lib/generator/types'

const SPEC = {
  version: 1,
  name: 'Crate',
  category: 'prop',
  palette: { wood: '#8a5a32' },
  parts: [{ name: 'Crate', type: 'box', size: [2, 2, 2], color: 'wood' }]
}

const RIGGED_SPEC = {
  version: 1,
  name: 'Puppy',
  category: 'character',
  rig: 'custom',
  palette: { fur: '#c98a4b' },
  skeleton: [
    { part: 'Body', parent: 'HumanoidRootPart', joint: 'Root' },
    { part: 'Head', parent: 'Body', joint: 'Neck' }
  ],
  parts: [
    { name: 'Body', type: 'box', size: [1, 1, 1], pivot: [0, 0, 0] },
    { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 2, 0], pivot: [0, 1.5, 0] }
  ]
}

const brain: Brain = { id: 'claude', scope: 'gen/3d' }

/** A transport that replies with a scripted sequence and records the traffic. */
function scriptedTransport(replies: string[]) {
  const sent: Array<{
    scope: string
    system: string
    messages: Array<{ role: string; text: string; image?: string }>
  }> = []
  return {
    sent,
    transport: {
      send: async (request: {
        scope: string
        system: string
        messages: Array<{ role: string; text: string; image?: string }>
      }) => {
        sent.push(request)
        const reply = replies.shift()
        if (reply === undefined) throw new Error('no reply left')
        return reply
      }
    }
  }
}

function deps(overrides: Partial<Model3DToolDeps> = {}): Model3DToolDeps {
  const { transport } = scriptedTransport([])
  return {
    queue: new TaskQueue(),
    brain,
    askBrain: createAskBrain({ transport }),
    brainTakesImages: createBrainTakesImages(() => false),
    system: 'You design Roblox 3D models.',
    ...overrides
  }
}

/** Decode a `data:` URL's base64 body into bytes. */
function bytesOf(dataUrl: string): Uint8Array {
  const body = dataUrl.split(',')[1] ?? ''
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('generate_3d tool contract', () => {
  it('declares `prompt` as the only required field', () => {
    expect(GENERATE_3D_INPUT_SCHEMA.required).toEqual(['prompt'])
  })

  it('offers the six categories in the schema', () => {
    expect(GENERATE_3D_INPUT_SCHEMA.properties.category.enum).toEqual([
      'accessory',
      'prop',
      'building',
      'tool',
      'text',
      'character'
    ])
  })

  it('omits the context block when no Studio is attached', () => {
    expect(firstModelMessage({ prompt: 'x', category: 'prop' }).text).not.toContain(
      'Robloxkit session context'
    )
  })

  it('asks for a correction when a spec is supplied', () => {
    const message = firstModelMessage({ prompt: 'taller', category: 'prop', spec: SPEC })
    expect(message.text).toContain('Return the whole updated spec')
    expect(message.text).toContain('Change: taller')
  })
})

describe('generate_3d end to end', () => {
  it('returns a task id immediately, then a full artifact on poll', async () => {
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(SPEC)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
      prompt: 'a simple crate',
      category: 'prop'
    })

    expect(accepted.taskId).toMatch(/^task-/)
    expect(accepted.note).toContain('get_3d_task')

    await queue.drain()

    const polled = readModelResult(queue, accepted.taskId)
    expect(polled.status).toBe('done')
    expect(polled.summary).toContain('ready')

    expect(polled.spec).toMatchObject({ name: 'Crate', category: 'prop' })
    expect(polled.report?.ok).toBe(true)
    expect(polled.report?.triangles).toBe(12)
    expect(polled.layout).toContain('Crate:')

    // The GLB is the artifact the viewport reads and Roblox accepts.
    expect(polled.model).toMatch(/^data:model\/gltf-binary;base64,/)
    // jsdom has no WebGL, so the review render is skipped rather than fatal —
    // that is the documented headless behaviour, and the reason a valid model
    // still counts. The rendered pixels are verified in the dev binary.
    expect(polled.image).toBeUndefined()
    expect(polled.image2).toBeUndefined()

    // The OBJ trio rides along for a user who wants a mesh file.
    expect(polled.obj).toMatch(/^data:text\/plain;base64,/)
    expect(polled.mtl).toMatch(/^data:text\/plain;base64,/)
    expect(polled.palette).toMatch(/^data:image\/png;base64,/)

    expect(sent).toHaveLength(2)
    expect(sent[0].scope).toBe('gen/3d')
    expect(sent[0].messages[0].text).toContain('Design a prop: a simple crate')
    // The deps' system prompt is what reaches the brain on the first turn.
    expect(sent[0].system).toBe('You design Roblox 3D models.')
  })

  it('is reproducible: two generations of one spec export identical GLB bytes', async () => {
    const run = async (): Promise<Uint8Array> => {
      const { transport } = scriptedTransport([
        `\`\`\`json\n${JSON.stringify(SPEC)}\n\`\`\``,
        'DONE'
      ])
      const queue = new TaskQueue()
      const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
        prompt: 'a crate',
        category: 'prop'
      })
      await queue.drain()
      return bytesOf(readModelResult(queue, accepted.taskId).model as string)
    }

    expect(Array.from(await run())).toEqual(Array.from(await run()))
  })

  it('echoes spec problems back to the brain and recovers', async () => {
    const bad = {
      version: 2,
      category: 'prop',
      palette: { a: '#ffffff' },
      parts: [{ type: 'box', size: [1, 1, 1] }]
    }
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``,
      `\`\`\`json\n${JSON.stringify(SPEC)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
      prompt: 'a crate',
      category: 'prop'
    })
    await queue.drain()

    expect(readModelResult(queue, accepted.taskId).status).toBe('done')

    const echoed = sent[1].messages[sent[1].messages.length - 1].text
    expect(echoed).toContain('The engine rejected the spec')
    expect(echoed).toContain('version: must be 1')
  })

  it('fails the task when the model never produces a usable spec', async () => {
    const { transport } = scriptedTransport(['no json', 'no json', 'no json', 'no json', 'no json'])
    const queue = new TaskQueue()

    const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
      prompt: 'x',
      category: 'prop'
    })
    await queue.drain()

    const polled = readModelResult(queue, accepted.taskId)
    expect(polled.status).toBe('failed')
    expect(polled.error ?? '').toContain('could not be built')
  })

  it('reports an unknown task id rather than throwing', () => {
    expect(readModelResult(new TaskQueue(), 'task-nope').status).toBe('failed')
  })

  it('surfaces a transport failure as a failed task, not a hang', async () => {
    const queue = new TaskQueue()
    const accepted = queueGenerate3D(
      {
        ...deps({ queue }),
        askBrain: async () => {
          throw new Error('transport down')
        }
      },
      { prompt: 'x', category: 'prop' }
    )
    await queue.drain()

    const polled = readModelResult(queue, accepted.taskId)
    expect(polled.status).toBe('failed')
    expect(polled.error).toContain('transport down')
  })

  it('a rigged spec yields a GLB whose node tree is a real bone hierarchy', async () => {
    const { transport } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(RIGGED_SPEC)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()

    const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
      prompt: 'a small puppy',
      category: 'character',
      rig: 'custom'
    })
    await queue.drain()

    const polled = readModelResult(queue, accepted.taskId)
    expect(polled.status).toBe('done')
    // Two sheets is the rigged shape; without WebGL they are skipped, so the
    // claim that holds here is the second sheet's absence, not its content.
    expect(polled.image2).toBeUndefined()

    // The GLB is checked structurally here. `GLTFLoader` needs an image decoder
    // for its texture and jsdom has none, so it would hang rather than fail;
    // the real loader is exercised against the dev binary instead.
    const glb = bytesOf(polled.model as string)
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    expect(view.getUint32(0, true)).toBe(0x46546c67) // "glTF"
    expect(view.getUint32(4, true)).toBe(2)
    expect(view.getUint32(8, true)).toBe(glb.length)

    const jsonLength = view.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as {
      nodes: { name: string; children?: number[] }[]
      skins?: unknown
    }
    const names = json.nodes.map((node) => node.name)
    expect(names).toContain('Body')
    expect(names).toContain('Head')
    // The rig is a node tree, not a glTF skin.
    expect(json.skins).toBeUndefined()
    // The bone root holds only the root bone, so the hierarchy is real.
    expect(json.nodes[0].children).toHaveLength(1)
  })

  it('sends Studio context ahead of the ask when a place is open', async () => {
    const { transport, sent } = scriptedTransport([
      `\`\`\`json\n${JSON.stringify(SPEC)}\n\`\`\``,
      'DONE'
    ])
    const queue = new TaskQueue()
    const studio = {
      studios: [{ id: 's1', name: 'My Obby' }],
      studioId: 's1',
      status: 'connected'
    }

    queueGenerate3D(
      deps({ queue, askBrain: createAskBrain({ transport }), studio: studio as never }),
      { prompt: 'a crate', category: 'prop' }
    )
    await queue.drain()

    // `askBrain` folds the system prompt into the first turn, so the text opens
    // with the prompt and the context block follows it.
    const text = sent[0].messages[0].text
    expect(text).toContain('You design Roblox 3D models.')
    expect(text).toContain('Robloxkit session context')
    expect(text).toContain('Open place: My Obby')
    expect(text).toContain(sessionContext(studio as never).split('\n')[0])
    expect(text).toContain('Design a prop: a crate')
    // The context must come before the ask, so the model reads where it is first.
    expect(text.indexOf('Open place: My Obby')).toBeLessThan(text.indexOf('Design a prop: a crate'))
  })

  it('carries the record slug through so a revision lands in its own record', async () => {
    const { transport } = scriptedTransport([`\`\`\`json\n${JSON.stringify(SPEC)}\n\`\`\``, 'DONE'])
    const queue = new TaskQueue()

    const accepted = queueGenerate3D(deps({ queue, askBrain: createAskBrain({ transport }) }), {
      prompt: 'a crate',
      category: 'prop',
      recordSlug: 'crate'
    })
    await queue.drain()

    expect(readModelResult(queue, accepted.taskId).recordSlug).toBe('crate')
  })
})

describe('the review the brain is shown', () => {
  it('names the test walk only when the model has bones', () => {
    const model = buildSpec(RIGGED_SPEC as never)
    const built = {
      spec: model,
      model,
      sheet: 'data:image/jpeg;base64,AAAA',
      sheet2: 'data:image/jpeg;base64,BBBB',
      report: { ok: true, issues: [], triangles: 12, size: [1, 1, 1] }
    } as unknown as BuildResult

    expect(modelReview(built, true, { category: 'character' }).lead).toContain('test walk')
    expect(modelReview(built, true, { category: 'prop' }).lead).not.toContain('test walk')
  })

  it('reports the triangle count and the size in studs', () => {
    const built = {
      spec: SPEC,
      report: { ok: true, issues: [], triangles: 12, size: [2, 2, 2] }
    } as unknown as BuildResult
    const review = modelReview(built)
    expect(review.facts).toContain('12 triangles')
    expect(review.facts).toContain('2 × 2 × 2 studs')
  })
})
