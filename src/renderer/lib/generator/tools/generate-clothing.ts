/**
 * `generate_clothing` as the agent sees it: return a `task_id` immediately, then
 * poll.
 *
 * Generation takes minutes, so blocking the MCP response would time out the
 * agent's turn. The shape here mirrors `index:18913-18980` Ã¢â‚¬â€ see
 * `re/full-reverse/01-generator-loop/REPORT.md` Ã‚Â§16.1 and
 * `10-tool-surface/REPORT.md` Ã‚Â§3.7.
 */

import { buildClothing } from '../engines/clothing/build'
import type { DesignType } from '../engines/clothing/schema'
import { designLoop } from '../loop'
import { type SessionStudio, sessionContext } from '../session-context'
import type { TaskQueue } from '../task-queue'
import type { AskBrain, Brain, BuildResult, LoopResult, Msg } from '../types'

/** The MCP tool name the agent calls. */
export const GENERATE_CLOTHING_TOOL = 'generate_clothing'

/** The garment types the tool accepts. */
export const CLOTHING_TOOL_TYPES = ['shirt', 'pants', 'tshirt'] as const

/** The input schema, verbatim from `index:18913` (required: `type`). */
export const GENERATE_CLOTHING_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    type: { type: 'string', enum: [...CLOTHING_TOOL_TYPES] },
    design: { type: 'object', description: 'Optional: a complete design instead of a prompt' }
  },
  required: ['type']
} as const

export interface GenerateClothingArgs {
  type: DesignType
  prompt?: string
  design?: unknown
  images?: string[]
  /** The agent executing the tool call; authoritative for routing. */
  agentId?: string
  /** The chat that asked. */
  sessionId?: string
}

/** What the tool returns before the work is done. */
export interface GenerateClothingAccepted {
  status: 'queued' | 'running'
  taskId: string
  stage: string
  note: string
}

/** What a poll returns once a task settles. */
export interface GenerateClothingResult {
  status: 'done' | 'failed' | 'cancelled' | 'running' | 'queued' | 'interrupted'
  taskId: string
  stage: string
  /** The design the engine accepted, when the task finished. */
  design?: unknown
  /** `data:image/png;base64,â€¦` of the rendered sheet. */
  image?: string
  /** What the checks found: `ok`, the issue list, size, coverage, colours. */
  report?: unknown
  /** One-line description for a model that cannot see the image. */
  layout?: string
  error?: string
  summary?: string
}

export interface ClothingToolDeps {
  queue: TaskQueue
  brain: Brain
  askBrain: AskBrain
  brainTakesImages: (brain: Brain) => Promise<boolean>
  /** The system prompt for the clothing engine. */
  system: string
  /** Live Studio state, folded into the first user message. */
  studio?: SessionStudio
  /**
   * Which agent to run on, per generation.
   *
   * Resolved from the task, not from the deps, because `deps` is built once when
   * the gateway installs its handler and a window can serve chats on different
   * harnesses. Returning `null` means "no agent", which the transport reports.
   */
  agentFor?: (task: { agentId?: string | null; sessionId?: string | null }) => string | null
  images?: string[]
}

/**
 * The note returned with a task id.
 *
 * Derived from the engine name rather than hard-coded, because the poll tool is
 * `get_<engine>_task`: an earlier constant named `get_task_result`, which does
 * not exist, and the model was told to call it.
 */
export function acceptedNote(engine = 'clothing'): string {
  return `Still designing in the background. Carry on; call get_${engine}_task with this task_id.`
}

/**
 * Build the first user message. The Studio context block goes first so the
 * model reads where it is before what it was asked for (`acp:967`).
 */
export function firstMessage(args: GenerateClothingArgs, studio?: SessionStudio): Msg {
  const parts: string[] = []
  if (studio) parts.push(sessionContext(studio))

  if (args.design) {
    parts.push(
      `Fix this ${args.type} design JSON and return the whole corrected design:\n\`\`\`json\n${JSON.stringify(args.design, null, 2)}\n\`\`\``
    )
  } else {
    parts.push(`Design a ${args.type}: ${args.prompt ?? 'anything that fits the garment'}.`)
  }

  return { role: 'user', text: parts.join('\n\n') }
}

/** What the model is told to judge during the checking stage. */
export function clothingReview(built: BuildResult): {
  lead: string
  facts: string
  layout?: string
} {
  const report = built.report
  const issues = report.issues.length
    ? `Issues: ${report.issues.map((issue) => `[${issue.level}] ${issue.message}`).join('; ')}.`
    : 'No issues found.'

  return {
    lead: 'Here is the garment sheet you designed, laid out flat as Roblox maps it onto the body.',
    facts: `Checks ${report.ok ? 'passed' : 'failed'}. ${issues}`,
    layout: built.layout
  }
}

/**
 * Queue a clothing generation and return its task id at once.
 *
 * A `design` argument skips the authoring stage: the loop's first turn is the
 * correction request instead of a blank design brief.
 *
 * The handler is registered once per queue and reads its arguments from the
 * task, so two generations in flight cannot overwrite each other's prompt.
 */
export function queueGenerateClothing(
  deps: ClothingToolDeps,
  args: GenerateClothingArgs
): GenerateClothingAccepted {
  const queue = deps.queue

  if (!queue.hasHandler('clothing')) {
    queue.register('clothing', async ({ signal, report, task }) => {
      const incoming = task.params as GenerateClothingArgs
      return runClothingGeneration(deps, incoming, report, signal)
    })
  }

  const task = queue.spawn({
    kind: 'clothing',
    title: args.prompt ?? `${args.type} design`,
    params: args
  })

  return {
    status: task.status === 'running' ? 'running' : 'queued',
    taskId: task.id,
    stage: task.stage,
    note: acceptedNote('clothing')
  }
}

/** The task body: run the loop, then report what came out. */
export async function runClothingGeneration(
  deps: ClothingToolDeps,
  args: GenerateClothingArgs,
  report: (stage: string, detail?: string | null) => void,
  signal: AbortSignal
): Promise<LoopResult> {
  const agentId = deps.agentFor?.(args) ?? null
  const brain: Brain = { ...deps.brain, signal }
  if (agentId) brain.runtimeAgentId = agentId

  const images = args.images ?? deps.images ?? []

  const outcome = await designLoop({
    action: 'clothing',
    system: deps.system,
    first: firstMessage(args, deps.studio),
    prompt: args.prompt ?? `${args.type} design`,
    what: 'design',
    brain,
    askBrain: deps.askBrain,
    brainTakesImages: deps.brainTakesImages,
    build: async (spec) => buildClothing(spec, { type: args.type, images }),
    normalize: (spec) => spec,
    review: (built) => clothingReview(built),
    onStage: ({ stage, detail }) => report(stage, detail ?? null)
  })

  report('done', 'Design ready')
  return outcome
}

/** Read a task back in the shape the poll tool returns. */
export function readClothingResult(queue: TaskQueue, taskId: string): GenerateClothingResult {
  const task = queue.get(taskId)
  if (!task) {
    return { status: 'failed', taskId, stage: 'Unknown', error: `No task ${taskId}` }
  }
  if (task.status === 'done') {
    const built = task.result as { result?: unknown; built?: BuildResult } | null
    return {
      status: 'done',
      taskId,
      stage: task.stage,
      design: built?.built?.spec ?? built?.result ?? null,
      image: built?.built?.sheet,
      report: built?.built?.report,
      layout: built?.built?.layout,
      summary: `${task.title} is ready`
    }
  }
  if (task.status === 'failed') {
    return { status: 'failed', taskId, stage: task.stage, error: task.error ?? 'failed' }
  }
  return { status: task.status, taskId, stage: task.stage }
}
