/**
 * The 3D tool surface: the message the model gets, the review it reads, and
 * what a finished task reports.
 *
 * The review text is what the model judges the renders against, so its wording
 * is pinned here — in particular that it names **two** images for a rigged model
 * and mentions the test walk, because a model told about one picture and shown
 * two does not know what the second is for.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildSpec } from '@/lib/generator/engines/3d/build'
import type { checkModel } from '@/lib/generator/engines/3d/check'
import { MODEL_3D_SYSTEM_PROMPT } from '@/lib/generator/engines/3d/prompt'
import { TaskQueue } from '@/lib/generator/task-queue'
import {
  acceptedNote,
  buildModelArtifact,
  describeLayout,
  firstModelMessage,
  GENERATE_3D_INPUT_SCHEMA,
  GENERATE_3D_TOOL,
  MODEL_3D_CATEGORIES,
  type Model3DToolDeps,
  modelReview,
  queueGenerate3D,
  readModelResult,
  specParams,
  specProblems
} from '@/lib/generator/tools/generate-3d'
import type { Brain, BuildResult } from '@/lib/generator/types'

const VALID_SPEC = {
  version: 1,
  name: 'Crate',
  category: 'prop',
  palette: { wood: '#8a5a32' },
  parts: [{ type: 'box', size: [2, 2, 2], color: 'wood' }]
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
    { name: 'Head', type: 'box', size: [1, 1, 1], position: [0, 2, 0], pivot: [0, 1, 0] }
  ]
}

function deps(askBrain = vi.fn(async () => `\`\`\`json\n${JSON.stringify(VALID_SPEC)}\n\`\`\``)) {
  const queue = new TaskQueue()
  const brain: Brain = { id: 'claude' }
  const model3d: Model3DToolDeps = {
    queue,
    brain,
    askBrain,
    brainTakesImages: async () => false,
    system: MODEL_3D_SYSTEM_PROMPT
  }
  return { model3d, queue, askBrain }
}

describe('the tool contract', () => {
  it('is named generate_3d', () => {
    expect(GENERATE_3D_TOOL).toBe('generate_3d')
  })

  it('accepts exactly the six categories', () => {
    expect([...MODEL_3D_CATEGORIES]).toEqual([
      'accessory',
      'prop',
      'building',
      'tool',
      'text',
      'character'
    ])
  })

  it('declares a schema with prompt required and a spec escape hatch', () => {
    expect(GENERATE_3D_INPUT_SCHEMA.required).toEqual(['prompt'])
    expect(Object.keys(GENERATE_3D_INPUT_SCHEMA.properties)).toEqual([
      'prompt',
      'category',
      'accessoryType',
      'rig',
      'spec'
    ])
  })
})

describe('acceptedNote', () => {
  it('names the poll tool that exists', () => {
    expect(acceptedNote('3d')).toContain('get_3d_task')
    expect(acceptedNote('3d')).not.toContain('get_task_result')
  })

  it('defaults to the 3D engine', () => {
    expect(acceptedNote()).toContain('get_3d_task')
  })
})

describe('firstModelMessage', () => {
  it('opens with the engine prompt for a prop', () => {
    const message = firstModelMessage({ prompt: 'a crate', category: 'prop' })
    expect(message.role).toBe('user')
    expect(message.text.startsWith('Design a prop: a crate')).toBe(true)
    expect(message.text).toContain('Category rules:')
  })

  it('names the accessory slot', () => {
    const message = firstModelMessage({
      prompt: 'a pirate hat',
      category: 'accessory',
      accessoryType: 'Hat'
    })
    expect(message.text).toContain('Design an accessory (Hat): a pirate hat')
  })

  it('adds the rig guide for a character', () => {
    const message = firstModelMessage({ prompt: 'a knight', category: 'character', rig: 'R15' })
    expect(message.text).toContain('rigged character (rig: R15)')
    expect(message.text).toContain('Rig guide:')
  })

  it('does not add the rig guide for a prop', () => {
    expect(firstModelMessage({ prompt: 'a crate', category: 'prop' }).text).not.toContain(
      'Rig guide:'
    )
  })

  it('asks for the whole updated spec when a spec is supplied', () => {
    const message = firstModelMessage({ prompt: 'taller', category: 'prop', spec: VALID_SPEC })
    expect(message.text).toContain('Return the whole updated spec')
    expect(message.text).toContain('Change: taller')
  })

  it('defaults the category to prop', () => {
    expect(firstModelMessage({ prompt: 'a crate' }).text).toContain('Design a prop:')
  })

  it('puts the Studio context first when there is one', () => {
    const message = firstModelMessage(
      { prompt: 'a crate', category: 'prop' },
      { studios: [{ id: 'st-1', name: 'My Place' }], studioId: 'st-1', status: 'open' }
    )
    expect(message.text.indexOf('My Place')).toBeLessThan(message.text.indexOf('Design a prop:'))
  })
})

describe('modelReview', () => {
  const built = (overrides: Partial<BuildResult['report']> = {}): BuildResult => ({
    spec: VALID_SPEC,
    report: { ok: true, issues: [], triangles: 12, size: [2, 2, 2], ...overrides }
  })

  it('reports triangles and size', () => {
    const review = modelReview(built())
    expect(review.facts).toContain('12 triangles')
    expect(review.facts).toContain('2 × 2 × 2 studs')
  })

  it('says it passes when there are no issues', () => {
    expect(modelReview(built()).facts).toContain('It passes the rules.')
  })

  it('lists problems with their level', () => {
    const review = modelReview(
      built({
        issues: [
          { level: 'warn', message: 'a warning' },
          { level: 'error', message: 'a fault' }
        ]
      })
    )
    expect(review.facts).toContain('warn: a warning')
    expect(review.facts).toContain('error: a fault')
  })

  it('names the four sheet-1 views', () => {
    expect(modelReview(built()).lead).toContain('front, right, top, three-quarter')
  })

  it('adds the mannequin note for an accessory', () => {
    const review = modelReview(built(), true, { category: 'accessory' })
    expect(review.lead).toContain('on a mannequin for scale')
  })

  it('names the test walk for a rigged character', () => {
    const review = modelReview(built(), true, { category: 'character' })
    expect(review.lead).toContain('test walk')
    expect(review.lead).toContain('check no joint opens a gap')
    expect(review.lead).toContain('every limb bends where it should')
  })

  it('names the test walk whenever the model has bones, whatever the category', () => {
    const review = modelReview(built(), true, { category: 'prop', rigged: true })
    expect(review.lead).toContain('test walk')
  })

  it('falls back to text-only wording without a picture', () => {
    const review = modelReview(built(), false)
    expect(review.lead).toContain('no picture')
    expect(review.lead).toContain('layout below')
  })

  it('passes the layout through when the build has one', () => {
    const review = modelReview({ ...built(), layout: 'Body: pivot 0, 0, 0' })
    expect(review.layout).toContain('+Y up, front +Z')
    expect(review.layout).toContain('Body: pivot')
  })
})

describe('buildModelArtifact', () => {
  it('builds, checks and reports in one call', async () => {
    const built = await buildModelArtifact(VALID_SPEC, { category: 'prop' })
    expect(built.report.ok).toBe(true)
    expect(built.report.triangles).toBe(12)
    expect(built.model.groups).toHaveLength(1)
  })

  it('throws ModelRejected on an invalid spec, which is what the loop reads', async () => {
    await expect(buildModelArtifact({ version: 2 }, { category: 'prop' })).rejects.toThrow()
  })

  it('produces the export files', async () => {
    const built = await buildModelArtifact(VALID_SPEC, { category: 'prop' })
    const files = (built as { files?: Record<string, Uint8Array> }).files
    expect(files).toBeDefined()
    expect(Object.keys(files ?? {}).sort()).toEqual([
      'crate.glb',
      'crate.mtl',
      'crate.obj',
      'crate_palette.png'
    ])
  })

  it('survives a renderer that has no WebGL, because a valid model still counts', async () => {
    // jsdom has no WebGL, so this is the real headless path: the sheets are
    // absent and the report still says ok.
    const built = await buildModelArtifact(VALID_SPEC, { category: 'prop' })
    expect(built.report.ok).toBe(true)
    expect(built.sheet).toBeUndefined()
  })

  it('can skip the export, for a caller that only wants the check', async () => {
    const built = await buildModelArtifact(VALID_SPEC, { category: 'prop', exportMesh: false })
    expect((built as { files?: unknown }).files).toBeUndefined()
    expect(built.report.ok).toBe(true)
  })

  it('carries the built model, which check and export both need', async () => {
    const built = await buildModelArtifact(RIGGED_SPEC, { category: 'character' })
    expect(built.model.rigSpec?.rig).toBe('custom')
  })
})

describe('describeLayout', () => {
  it('lists every top-level part with its pivot and triangle count', () => {
    const model = buildSpec(
      {
        version: 1,
        category: 'prop',
        palette: { a: '#ffffff' },
        parts: [
          { name: 'One', type: 'box', size: [1, 1, 1], pivot: [1, 2, 3] },
          { name: 'Two', type: 'box', size: [1, 1, 1] }
        ]
      },
      {}
    )
    const layout = describeLayout(model)
    expect(layout).toContain('One: pivot 1, 2, 3; 12 triangles')
    expect(layout).toContain('Two: pivot 0, 0, 0; 12 triangles')
  })

  it('prints a fractional pivot to two decimals', () => {
    const model = buildSpec({
      version: 1,
      category: 'prop',
      palette: { a: '#ffffff' },
      parts: [{ name: 'One', type: 'box', size: [1, 1, 1], pivot: [0.5, 1.25, 0] }]
    })
    expect(describeLayout(model)).toContain('pivot 0.50, 1.25, 0')
  })
})

describe('queueGenerate3D and readModelResult', () => {
  it('queues a task and returns its id at once', () => {
    const { model3d } = deps()
    const accepted = queueGenerate3D(model3d, { prompt: 'a crate', category: 'prop' })
    expect(accepted.taskId).toBeTruthy()
    expect(accepted.note).toContain('get_3d_task')
  })

  it('runs to done and reports the GLB as a data URL', async () => {
    const { model3d, queue } = deps()
    const accepted = queueGenerate3D(model3d, { prompt: 'a crate', category: 'prop' })

    await vi.waitFor(() => expect(queue.get(accepted.taskId)?.status).toBe('done'), {
      timeout: 10000
    })

    const result = readModelResult(queue, accepted.taskId)
    expect(result.status).toBe('done')
    expect(result.model).toMatch(/^data:model\/gltf-binary;base64,/)
    expect(result.obj).toMatch(/^data:text\/plain;base64,/)
    expect(result.mtl).toMatch(/^data:text\/plain;base64,/)
    expect(result.palette).toMatch(/^data:image\/png;base64,/)
    expect(result.kind).toBe('prop')
    expect(result.name).toBe('Crate')
    expect(result.summary).toContain('ready')
  })

  it('reports the failure reason for an unknown task', () => {
    const { queue } = deps()
    const result = readModelResult(queue, 'nope')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('No task nope')
  })

  it('reports a build failure as a failed task, not a throw', async () => {
    const { model3d, queue } = deps(vi.fn(async () => '```json\n{"version":2}\n```'))
    const accepted = queueGenerate3D(model3d, { prompt: 'a crate', category: 'prop' })

    await vi.waitFor(() => expect(queue.get(accepted.taskId)?.status).toBe('failed'), {
      timeout: 15000
    })

    const result = readModelResult(queue, accepted.taskId)
    expect(result.status).toBe('failed')
    expect(result.error).toBeTruthy()
  })

  it('carries the record slug through, so a revision lands in its own record', async () => {
    const { model3d, queue } = deps()
    const accepted = queueGenerate3D(model3d, {
      prompt: 'a crate',
      category: 'prop',
      recordSlug: 'crate'
    })

    await vi.waitFor(() => expect(queue.get(accepted.taskId)?.status).toBe('done'), {
      timeout: 10000
    })

    expect(readModelResult(queue, accepted.taskId).recordSlug).toBe('crate')
  })
})

describe('specProblems and specParams', () => {
  it('reports no problems for a valid spec', () => {
    expect(specProblems(VALID_SPEC)).toEqual([])
  })

  it('reports the validator problems without building', () => {
    expect(specProblems({ version: 2 })).toContain('version: must be 1')
  })

  it('resolves params, clamped to their range', () => {
    expect(
      specParams({
        version: 1,
        category: 'prop',
        palette: { a: '#ffffff' },
        params: { h: { value: 4, min: 1, max: 8 } },
        parts: [{ type: 'box', size: [1, 1, 1] }]
      })
    ).toEqual({ h: 4 })
  })
})

describe('the report a caller sees', () => {
  it('is the category report, not the raw build report', async () => {
    const built = await buildModelArtifact(VALID_SPEC, { category: 'prop' })
    const report = built.report as unknown as ReturnType<typeof checkModel>
    expect(report.limit).toBe(20000)
    expect(report.parts).toHaveLength(1)
  })
})
