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
  /**
   * The record this generation revises, when it revises one.
   *
   * The host files a record by this slug, so a revision lands as a new version of
   * the same item instead of a second item beside it. Set by the page composer's
   * Apply; absent for a fresh garment.
   */
  recordSlug?: string
  /**
   * The garments already in the outfit, so this one can be made to match.
   *
   * Only ever set when the user turns "match outfit" on. RobloxKit has no such
   * feature - its prompt is `Design a <type>: <prompt>` and nothing else - so an
   * automatic version mixed a fresh garment with whatever else the project held,
   * which is why this is opt-in rather than the default.
   */
  companions?: OutfitCompanion[]
}

/** One garment already worn, as the model needs it to match a new one. */
export interface OutfitCompanion {
  type: DesignType
  name: string
  /** The current version's design, straight from `item.json`. */
  design: unknown
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
  /**
   * `data:image/png;base64,...` of the flat atlas, which the host writes into
   * the project and hands back as `save.path`.
   *
   * Separate from `image` because the review sheet is an avatar render and is
   * not uploadable: Roblox wants the atlas itself. The host strips this field
   * before the model sees the reply, so the bytes never reach the transcript.
   */
  atlas?: string
  kind?: DesignType
  name?: string
  /** The record this generation revises, when it revises one. */
  recordSlug?: string
  save?: { saved: boolean; path?: string; relative?: string; reason?: string }
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
  /**
   * Called as each visible layer reaches the sheet, so a page can show
   * "Drawing layer 5 of 7". The agent path leaves it unset: it only needs the
   * finished result.
   */
  onLayer?: (drawn: number, total: number, canvas: unknown) => void
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
    const ask = (args.prompt ?? 'anything that fits the garment').trim()
    parts.push(`Design a ${args.type}: ${endsSentence(ask) ? ask : `${ask}.`}`)
  }

  if (args.companions?.length) {
    const worn = args.companions.map(describeCompanion).join('\n')
    parts.push(
      `This garment is worn with others, so it has to look like one outfit. Match their colours, motifs and style:\n${worn}`
    )
  }

  return { role: 'user', text: parts.join('\n\n') }
}

function endsSentence(text: string): boolean {
  return /[.!?]$/.test(text)
}

/** A design longer than this is summarised: two full ones cost 18k characters. */
const COMPANION_JSON_LIMIT = 1200

/**
 * One companion as a line the model can match against.
 *
 * A real garment is up to 40 layers, so the full design is sent only while it is
 * small. Past the limit, the colours, the layer kinds and what they paint are
 * what "make it match" needs, and the per-layer geometry is what costs tokens.
 */
function describeCompanion(one: OutfitCompanion): string {
  const full = JSON.stringify(one.design)
  if (full.length <= COMPANION_JSON_LIMIT) return `- ${one.type} "${one.name}": ${full}`

  const design = (one.design ?? {}) as {
    background?: unknown
    layers?: Array<{
      kind?: unknown
      target?: unknown
      color?: unknown
      color2?: unknown
      color3?: unknown
    }>
  }
  const colors = new Set<string>()
  const kinds = new Set<string>()
  const targets = new Set<string>()
  for (const layer of design.layers ?? []) {
    for (const value of [layer.color, layer.color2, layer.color3]) {
      if (typeof value === 'string') colors.add(value)
    }
    if (typeof layer.kind === 'string') kinds.add(layer.kind)
    if (typeof layer.target === 'string') targets.add(layer.target)
  }
  if (typeof design.background === 'string') colors.add(design.background)

  const summary = {
    background: design.background ?? null,
    layers: design.layers?.length ?? 0,
    kinds: [...kinds],
    targets: [...targets],
    colors: [...colors]
  }
  return `- ${one.type} "${one.name}" (${summary.layers} layers, summarised): ${JSON.stringify(summary)}`
}

/** What the model is told to judge during the checking stage. */
export function clothingReview(
  built: BuildResult,
  hasImage = true
): {
  lead: string
  facts: string
  layout?: string
} {
  const report = built.report
  const issues = report.issues.length
    ? `Issues: ${report.issues.map((issue) => `[${issue.level}] ${issue.message}`).join('; ')}.`
    : 'No issues found.'

  return {
    lead: hasImage
      ? 'Here is the garment you designed, laid out flat as Roblox maps it onto the body.'
      : 'The renderer drew it (no picture: judge it from the description below).',
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
    build: async (spec) => buildClothing(spec, { type: args.type, images, onLayer: deps.onLayer }),
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
    const spec = built?.built?.spec as { type?: DesignType; name?: string } | undefined
    const params = task.params as GenerateClothingArgs | undefined
    return {
      status: 'done',
      taskId,
      stage: task.stage,
      design: built?.built?.spec ?? built?.result ?? null,
      image: built?.built?.sheet,
      atlas: built?.built?.template as string | undefined,
      kind: spec?.type,
      name: spec?.name,
      // Carried through so the host files a revision into the record it revises
      // instead of into whatever folder the model's name happens to slug to.
      recordSlug: params?.recordSlug,
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
