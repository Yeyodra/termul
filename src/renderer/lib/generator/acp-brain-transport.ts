/**
 * The transport `designLoop` calls a model through.
 *
 * A generator runs inside an MCP tool call the agent already made, so it
 * cannot reuse that turn's session: it opens its own ACP session, scoped to
 * the engine, sends one prompt, collects the reply from the streaming
 * `message_chunk` events, and closes the session. Without the close every
 * artifact would leak one session.
 *
 * The reply is assembled from events rather than a return value because
 * `send_prompt` answers with a receipt, not the text.
 */

import {
  acpCloseSession,
  acpNewSession,
  acpSendPrompt,
  type ChunkRole,
  type MessageChunkEvent,
  onAcpEvent,
  type PromptCompleteEvent
} from '@/lib/acp-api'
import type { BrainTransport } from '@/lib/generator/ask-brain'

export interface AcpBrainTransportOptions {
  /** Which ACP agent answers: a runtime agent id, resolved per call. */
  agentId: () => string | null
  /** Working directory for the session. */
  cwd: string
  /** How long one turn may take before the call gives up. */
  turnTimeoutMs?: number
}

/** Generous: an engine's authoring turn writes a whole spec document. */
const DEFAULT_TURN_TIMEOUT_MS = 300_000

/**
 * Build a `BrainTransport` that runs one turn per call on a fresh session.
 *
 * The system prompt is already folded into the first user message by
 * `flattenForBrain`, so nothing here needs a system-prompt channel — which is
 * just as well, since ACP has no portable one.
 */
export function createAcpBrainTransport(options: AcpBrainTransportOptions): BrainTransport {
  const timeoutMs = options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS

  return {
    async send({ scope, messages }) {
      const last = messages[messages.length - 1]
      if (!last) throw new Error('a generator turn needs at least one message')

      const agentId = options.agentId()
      if (!agentId) {
        throw new Error(
          'no ACP agent is running, so the generator has nothing to ask; start a chat first'
        )
      }

      const session = await acpNewSession(agentId, options.cwd, [], {
        ephemeral: true,
        promotable: false
      })
      const sessionId = session.sessionId

      const text = messages.map((m) => m.text).join('\n\n')
      let collected = ''

      const stopChunks = onAcpEvent<MessageChunkEvent>('acp:message_chunk', (event) => {
        if (event.sessionId !== sessionId) return
        const role: ChunkRole = event.role
        if (role !== 'agent') return
        const chunk = event.content.text
        if (typeof chunk === 'string') collected += chunk
      })

      const finished = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`the ${scope} turn produced nothing within ${timeoutMs} ms`))
        }, timeoutMs)
        const stop = onAcpEvent<PromptCompleteEvent>('acp:prompt_complete', (event) => {
          if (event.sessionId !== sessionId) return
          clearTimeout(timer)
          stop()
          resolve()
        })
      })

      try {
        await acpSendPrompt(agentId, sessionId, text)
        await finished
        return collected
      } finally {
        stopChunks()
        await acpCloseSession(agentId, sessionId).catch(() => undefined)
      }
    }
  }
}
