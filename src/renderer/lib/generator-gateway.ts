/**
 * Wires the generator tools into this window: installs the handler the host
 * forwards `generate_*` calls to, and gives `designLoop` a transport that
 * reaches a model.
 *
 * The engine runs here rather than in the MCP child because a generation
 * needs a canvas to rasterise into and an ACP session to ask a model on —
 * neither exists in the child process.
 */

import type { AcpTransport } from '@/lib/acp-transport'
import { getAcpTransport } from '@/lib/acp-transport'
import { createAcpBrainTransport } from '@/lib/generator/acp-brain-transport'
import {
  type GeneratorAgent,
  type GeneratorAgentHint,
  resolveGeneratorAgent
} from '@/lib/generator/agent-selection'
import { createAskBrain, createBrainTakesImages } from '@/lib/generator/ask-brain'
import { CLOTHING_SYSTEM_PROMPT } from '@/lib/generator/engines/clothing'
import { createGeneratorHandler } from '@/lib/generator/gateway-handler'
import { TaskQueue } from '@/lib/generator/task-queue'
import type { ClothingToolDeps } from '@/lib/generator/tools/generate-clothing'
import type { Brain } from '@/lib/generator/types'

export interface GeneratorGatewayOptions {
  /** Working directory for generator sessions: the active project. */
  cwd: string
  /** The engine's system prompt. Defaults to the clothing prompt. */
  system?: string
  /** Defaults to a fresh `TaskQueue` with the ported budgets. */
  queue?: TaskQueue
  /** Overrides agent resolution (tests). */
  agent?: () => GeneratorAgent | null
}

/**
 * Start serving generator calls from this window. Returns the stop.
 *
 * The agent is resolved per call, not once: a chat can switch agent between
 * two generations, and both the system-prompt fold and the vision gate depend
 * on which agent is in play.
 */
export function startGeneratorGateway(
  options: GeneratorGatewayOptions,
  transport: AcpTransport = getAcpTransport()
): { stop: () => void; queue: TaskQueue } {
  const gateway = transport.generator
  if (!gateway) return { stop: () => {}, queue: options.queue ?? new TaskQueue() }

  const queue = options.queue ?? new TaskQueue()
  const resolve = options.agent ?? ((hint: GeneratorAgentHint) => resolveGeneratorAgent(hint))
  const brainOf = (hint: GeneratorAgentHint): Brain => {
    const agent = resolve(hint)
    return agent ? { id: brainIdOf(agent.id), takesImages: agent.takesImages } : { id: 'custom' }
  }

  const clothing = {
    queue,
    brain: brainOf({ cwd: options.cwd }),
    askBrain: createAskBrain({
      transport: createAcpBrainTransport({
        agentId: () => resolve({ cwd: options.cwd })?.id ?? null,
        cwd: options.cwd
      })
    }),
    brainTakesImages: createBrainTakesImages(
      () => resolve({ cwd: options.cwd })?.takesImages ?? false
    ),
    agentFor: (task: { agentId?: string | null; sessionId?: string | null }) =>
      resolve({ agentId: task.agentId, sessionId: task.sessionId, cwd: options.cwd })?.id ?? null,
    system: options.system ?? CLOTHING_SYSTEM_PROMPT
  }

  gateway.setHandler(createGeneratorHandler({ queue, clothing }))
  // The page composer runs the same engine the agent's tool call would, so it
  // needs the same deps. Handing them out here is what keeps one task queue and
  // one system prompt for both entry points.
  setPageGeneratorDeps({ queue, clothing })

  return {
    stop: () => {
      gateway.setHandler(null)
      setPageGeneratorDeps(null)
      queue.cancelAll()
    },
    queue
  }
}

/** The deps a page uses to start a generation itself. */
interface PageGeneratorDeps {
  queue: TaskQueue
  clothing: ClothingToolDeps
}

let pageGeneratorDeps: PageGeneratorDeps | null = null

function setPageGeneratorDeps(deps: PageGeneratorDeps | null): void {
  pageGeneratorDeps = deps
}

/**
 * The engine deps this window is serving, or `null` when no project is open.
 *
 * A page calls this to run a generation the user asked for directly, instead of
 * waiting for an agent's tool call. It is the same `TaskQueue` and the same
 * system prompt the agent path uses, so both produce identical records.
 */
export function pageGenerator(): PageGeneratorDeps | null {
  return pageGeneratorDeps
}

/**
 * Map a runtime agent id onto a `Brain.id`.
 *
 * Only used for logging and for the `custom` fallback; the system-prompt fold
 * no longer branches on it, because every agent here speaks ACP.
 */
function brainIdOf(agentId: string): Brain['id'] {
  if (agentId.includes('claude')) return 'claude'
  if (agentId.includes('codex')) return 'codex'
  if (agentId.includes('kiro')) return 'kiro'
  if (agentId.includes('cursor')) return 'cursor'
  if (agentId.includes('gemini')) return 'gemini'
  if (agentId.includes('opencode')) return 'opencode'
  return 'custom'
}
