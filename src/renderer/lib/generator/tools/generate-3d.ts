/**
 * `generate_3d` as the agent sees it: return a `task_id` immediately, then poll.
 *
 * Same shape as `generate_clothing` for the same reason: a generation takes
 * minutes, so blocking the MCP response would time out the agent's turn. See
 * `re/full-reverse/15-3d-full-system/04-termul-implementation-map.md` §3 and
 * `08-PLAN-termul-implementation.md` §12.
 *
 * Everything engine-agnostic is reused unchanged: the task queue, the design
 * loop, the brain transport, the budget. Only `build` and `review` differ, and
 * the system prompt.
 */
import { buildModel, type Model } from '../engines/3d/build'
import { checkModel } from '../engines/3d/check'
import { exportFiles, shouldMerge } from '../engines/3d/export'
import { firstMessage, MODEL_3D_SYSTEM_PROMPT } from '../engines/3d/prompt'
import {
  CATEGORIES,
  type ModelSpec,
  normalizeSpec,
  paramValues,
  validateSpec
} from '../engines/3d/schema'
import { renderReviewSheets } from '../engines/3d/sheet'
import { designLoop } from '../loop'
import { type SessionStudio, sessionContext } from '../session-context'
import type { TaskQueue } from '../task-queue'
import type { AskBrain, Brain, BuildResult, LoopResult, Msg, ReviewParts } from '../types'

/** The MCP tool name the agent calls. */
export const GENERATE_3D_TOOL = 'generate_3d'

/** The spec categories the tool accepts. */
export const MODEL_3D_CATEGORIES = CATEGORIES

/** The input schema, mirroring the clothing tool's shape. */
export const GENERATE_3D_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    category: { type: 'string', enum: [...CATEGORIES] },
    accessoryType: { type: 'string' },
    rig: { type: 'string', enum: ['R15', 'R6', 'custom'] },
    spec: { type: 'object', description: 'Optional: a complete spec instead of a prompt' }
  },
  required: ['prompt']
} as const

export interface Generate3DArgs {
  prompt?: string
  category?: string
  accessoryType?: string
  rig?: string
  spec?: unknown
  /** The agent executing the tool call; authoritative for routing. */
  agentId?: string
  /** The chat that asked. */
  sessionId?: string
  /** The record this generation revises, when it revises one. */
  recordSlug?: string
}

/** What the tool returns before the work is done. */
export interface Generate3DAccepted {
  status: 'queued' | 'running'
  taskId: string
  stage: string
  note: string
}

/** What a poll returns once a task settles. */
export interface Generate3DResult {
  status: 'done' | 'failed' | 'cancelled' | 'running' | 'queued' | 'interrupted'
  taskId: string
  stage: string
  /** The spec the engine accepted, when the task finished. */
  spec?: unknown
  /** `data:image/jpeg;base64,…` of sheet 1, the four canonical views. */
  image?: string
  /** `data:image/jpeg;base64,…` of sheet 2, close-ups and a test walk, when rigged. */
  image2?: string
  /**
   * `data:model/gltf-binary;base64,…` of the model.
   *
   * This is what the host writes into the project as `v<n>.glb` and what the
   * viewport reads. It is also the artifact that can be uploaded to Roblox,
   * unlike a clothing atlas. The host strips it before the model sees the
   * reply, so the bytes never reach the transcript.
   */
  model?: string
  /** `data:text/plain;base64,…` of the OBJ, for a user who wants a mesh. */
  obj?: string
  /** `data:text/plain;base64,…` of the MTL beside the OBJ. */
  mtl?: string
  /** `data:image/png;base64,…` of the palette atlas the OBJ references. */
  palette?: string
  kind?: string
  name?: string
  recordSlug?: string
  save?: { saved: boolean; path?: string; relative?: string; reason?: string }
  /** What the checks found: `ok`, the issue list, triangles, size. */
  report?: unknown
  /** One-line description for a model that cannot see the images. */
  layout?: string
  error?: string
  summary?: string
}

export interface Model3DToolDeps {
  queue: TaskQueue
  brain: Brain
  askBrain: AskBrain
  brainTakesImages: (brain: Brain) => Promise<boolean>
  /** The system prompt for the 3D engine. */
  system: string
  /** Live Studio state, folded into the first user message. */
  studio?: SessionStudio
  /** Which agent to run on, per generation. */
  agentFor?: (task: { agentId?: string | null; sessionId?: string | null }) => string | null
}

/**
 * The first user message: Studio context, then the engine's own opening.
 *
 * The opening is `Design a <category>: <prompt>` or the edit form, both from
 * `prompt.ts`, so the wording lives with the system prompt that explains it.
 */
export function firstModelMessage(args: Generate3DArgs, studio?: SessionStudio): Msg {
  const parts: string[] = []
  if (studio) parts.push(sessionContext(studio))

  parts.push(
    firstMessage({
      prompt: (args.prompt ?? 'anything that fits the category').trim(),
      category: args.category ?? 'prop',
      accessoryType: args.accessoryType,
      rig: args.rig ?? 'R15',
      base: args.spec
    })
  )

  return { role: 'user', text: parts.join('\n\n') }
}

/**
 * What the model is told to judge during the checking stage.
 *
 * The lead names **both** sheets when a rigged model produced two, because a
 * model that is told about one image and shown two does not know what the
 * second is for. The wording is the original's (`gen3d-BAdfthxw.js:745-753`),
 * including the mannequin note for an accessory and the joint note for a rigged
 * character.
 */
export function modelReview(
  built: BuildResult,
  hasImage = true,
  { category, rigged = false }: { category?: string; rigged?: boolean } = {}
): ReviewParts {
  const report = built.report
  const issues = report.issues as { level: string; message: string }[]
  const facts = issues.length
    ? `Problems:\n- ${issues.map((issue) => `${issue.level}: ${issue.message}`).join('\n- ')}`
    : 'It passes the rules.'

  const triangles = typeof report.triangles === 'number' ? report.triangles : 0
  const size = Array.isArray(report.size) ? (report.size as number[]) : [0, 0, 0]

  const sheetNote =
    category === 'accessory'
      ? ', on a mannequin for scale'
      : category === 'character' || rigged
        ? '; and on the right, posed mid-stride in a test walk, from the side and ' +
          'three-quarters: check no joint opens a gap and every limb bends where it should'
        : ''

  return {
    lead: hasImage
      ? `Here is what the engine built (front, right, top, three-quarter${sheetNote}).`
      : 'The engine built it (no picture: judge it from the layout below).',
    facts: `${triangles} triangles, size ${size.join(' × ')} studs.${
      issues.length ? `\n${facts}` : ` ${facts}`
    }`,
    layout: built.layout
      ? `\nWhere each top-level part ended up (studs; +Y up, front +Z):\n${built.layout}`
      : ''
  }
}

/**
 * Queue a 3D generation and return its task id at once.
 *
 * A `spec` argument skips the authoring stage: the loop's first turn is the
 * correction request instead of a blank brief.
 */
export function queueGenerate3D(deps: Model3DToolDeps, args: Generate3DArgs): Generate3DAccepted {
  const queue = deps.queue

  if (!queue.hasHandler('3d')) {
    queue.register('3d', async ({ signal, report, task }) => {
      const incoming = task.params as Generate3DArgs
      return runModelGeneration(deps, incoming, report, signal)
    })
  }

  const task = queue.spawn({
    kind: '3d',
    title: args.prompt ?? `${args.category ?? 'prop'} model`,
    params: args
  })

  return {
    status: task.status === 'running' ? 'running' : 'queued',
    taskId: task.id,
    stage: task.stage,
    note: acceptedNote('3d')
  }
}

/**
 * The note returned with a task id.
 *
 * Derived from the engine name because the poll tool is `get_3d_task`; naming
 * the wrong tool here would send the model looking for a function that does not
 * exist, which is a mistake clothing already made once.
 */
export function acceptedNote(engine = '3d'): string {
  return `Still designing in the background. Carry on; call get_${engine}_task with this task_id.`
}

/**
 * Build one spec end to end: build, check, render, export, describe.
 *
 * The order matters. `buildModel` throws `ModelRejected` on an invalid spec, so
 * validation happens before anything expensive. The check then decides
 * `report.ok`, which gates `DONE`. The sheets are rendered only after the
 * check, because a model with no geometry has nothing to show. Export runs
 * last: it is the most expensive step and only a passing model is worth
 * exporting.
 *
 * A rendering failure is not fatal. A headless caller has no WebGL, and a
 * generation that produced a valid model should not fail because it could not
 * take a picture of it — the loop then reviews text-only.
 */
export async function buildModelArtifact(
  spec: unknown,
  {
    category,
    accessoryType,
    params,
    exportMesh = true
  }: {
    category?: string
    accessoryType?: string
    params?: Record<string, unknown>
    exportMesh?: boolean
  } = {}
): Promise<BuildResult & { model: Model }> {
  const built = await buildModel(spec, { params })
  const model = built.model
  const report = checkModel(model, { category, accessoryType })

  let sheet: string | undefined
  let sheet2: string | undefined
  try {
    const sheets = renderReviewSheets(model)
    sheet = sheets[0]
    sheet2 = sheets[1]
  } catch {
    // No WebGL: review from the layout text instead.
  }

  let files: Record<string, Uint8Array> | undefined
  if (exportMesh) {
    try {
      files = exportFiles(model, { merge: shouldMerge(model, category) })
    } catch {
      files = undefined
    }
  }

  return {
    spec,
    model,
    sheet,
    sheet2,
    files,
    report: {
      ...built.report,
      ...report,
      ok: report.ok,
      triangles: report.triangles,
      size: report.size
    },
    layout: describeLayout(model)
  } as BuildResult & { model: Model }
}

/**
 * The part inventory the model reads when it cannot see the renders.
 *
 * Unmirrored on purpose: the reviewer is told the truth about the spec space
 * (+Z front), which is what the model authored. The mirror is an export-time
 * operation only (`08` §G14).
 */
export function describeLayout(model: Model): string {
  return model.groups
    .map((group) => {
      const parts = model.parts.filter((part) => part.node === group.node)
      const triangles = parts.reduce(
        (total, part) => total + part.geometry.attributes.position.count / 3,
        0
      )
      const [x, y, z] = group.pivot
      return `${group.name}: pivot ${fmt(x)}, ${fmt(y)}, ${fmt(z)}; ${Math.round(triangles)} triangles`
    })
    .join('\n')
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** The task body: run the loop, then report what came out. */
export async function runModelGeneration(
  deps: Model3DToolDeps,
  args: Generate3DArgs,
  report: (stage: string, detail?: string | null) => void,
  signal: AbortSignal
): Promise<LoopResult> {
  const agentId = deps.agentFor?.(args) ?? null
  const brain: Brain = { ...deps.brain, signal }
  if (agentId) brain.runtimeAgentId = agentId

  const category = args.category ?? 'prop'

  const outcome = await designLoop({
    action: '3d',
    system: deps.system || MODEL_3D_SYSTEM_PROMPT,
    first: firstModelMessage(args, deps.studio),
    prompt: args.prompt ?? `${category} model`,
    what: 'spec',
    brain,
    askBrain: deps.askBrain,
    brainTakesImages: deps.brainTakesImages,
    build: async (spec) =>
      buildModelArtifact(spec, {
        category,
        accessoryType: args.accessoryType
      }),
    normalize: (spec) => normalizeSpec(spec as ModelSpec, category),
    review: (built) =>
      modelReview(built, true, {
        category,
        rigged: Boolean((built as { model?: Model }).model?.rigSpec)
      }),
    missing: 'The reply had no JSON spec. Answer with one ```json block.',
    onStage: ({ stage, detail }) => report(stage, detail ?? null)
  })

  report('done', 'Model ready')
  return outcome
}

/** Encode bytes as a `data:` URL. */
function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** Read a task back in the shape the poll tool returns. */
export function readModelResult(queue: TaskQueue, taskId: string): Generate3DResult {
  const task = queue.get(taskId)
  if (!task) {
    return { status: 'failed', taskId, stage: 'Unknown', error: `No task ${taskId}` }
  }

  if (task.status === 'done') {
    const outcome = task.result as {
      result?: unknown
      built?: BuildResult & {
        model?: Model
        sheet2?: string
        files?: Record<string, Uint8Array>
      }
    } | null

    const built = outcome?.built
    const spec = built?.spec as ModelSpec | undefined
    const files = built?.files

    // The GLB is the artifact: it is what the viewport reads and what Roblox
    // accepts. The OBJ trio rides along for a user who wants a mesh file.
    const glbKey = files ? Object.keys(files).find((name) => name.endsWith('.glb')) : undefined
    const objKey = files ? Object.keys(files).find((name) => name.endsWith('.obj')) : undefined
    const mtlKey = files ? Object.keys(files).find((name) => name.endsWith('.mtl')) : undefined
    const pngKey = files ? Object.keys(files).find((name) => name.endsWith('.png')) : undefined

    return {
      status: 'done',
      taskId,
      stage: task.stage,
      spec: built?.spec ?? outcome?.result ?? null,
      image: built?.sheet,
      image2: built?.sheet2,
      model: files && glbKey ? dataUrl(files[glbKey], 'model/gltf-binary') : undefined,
      obj: files && objKey ? dataUrl(files[objKey], 'text/plain') : undefined,
      mtl: files && mtlKey ? dataUrl(files[mtlKey], 'text/plain') : undefined,
      palette: files && pngKey ? dataUrl(files[pngKey], 'image/png') : undefined,
      kind: spec?.category,
      name: spec?.name,
      recordSlug: (task.params as Generate3DArgs | undefined)?.recordSlug,
      report: built?.report,
      layout: built?.layout,
      summary: `${task.title} is ready`
    }
  }

  if (task.status === 'failed') {
    return { status: 'failed', taskId, stage: task.stage, error: task.error ?? 'failed' }
  }

  return { status: task.status, taskId, stage: task.stage }
}

/**
 * A spec's problems, without building it.
 *
 * Exposed so a caller can reject an obviously invalid spec before paying for a
 * build, and so the tool can answer a `spec`-only call synchronously when the
 * caller does not want a generation.
 */
export function specProblems(spec: unknown): string[] {
  return validateSpec(spec)
}

/** The parameter values a spec resolves to, for a caller showing sliders. */
export function specParams(spec: unknown): Record<string, number> {
  return paramValues(spec as ModelSpec)
}
