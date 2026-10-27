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
import { resolveGeneratorAgentId } from '@/lib/generator/agent-selection'
import {
  createAskBrain,
  createBrainTakesImages,
  defaultTakesImages
} from '@/lib/generator/ask-brain'
import { CLOTHING_SYSTEM_PROMPT } from '@/lib/generator/engines/clothing'
import { createGeneratorHandler } from '@/lib/generator/gateway-handler'
import { TaskQueue } from '@/lib/generator/task-queue'
import type { Brain } from '@/lib/generator/types'

export interface GeneratorGatewayOptions {
  /** Working directory for generator sessions: the active project. */
  cwd: string
  /** The engine's system prompt. Defaults to the clothing prompt. */
  system?: string
  /** Defaults to a fresh `TaskQueue` with the ported budgets. */
  queue?: TaskQueue
}

/** Start serving generator calls from this window. Returns the stop. */
export function startGeneratorGateway(
  options: GeneratorGatewayOptions,
  transport: AcpTransport = getAcpTransport()
): () => void {
  const gateway = transport.generator
  if (!gateway) return () => {}

  const queue = options.queue ?? new TaskQueue()
  const brain: Brain = { id: 'claude' }
  const askBrain = createAskBrain({
    transport: createAcpBrainTransport({
      agentId: () => resolveGeneratorAgentId(),
      cwd: options.cwd
    })
  })
  const brainTakesImages = createBrainTakesImages(defaultTakesImages)

  gateway.setHandler(
    createGeneratorHandler({
      queue,
      clothing: {
        queue,
        brain,
        askBrain,
        brainTakesImages,
        system: options.system ?? CLOTHING_SYSTEM_PROMPT
      }
    })
  )

  return () => {
    gateway.setHandler(null)
    queue.cancelAll()
  }
}
