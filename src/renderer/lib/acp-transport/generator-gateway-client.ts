/**
 * The renderer leg of the generator gateway.
 *
 * The host forwards an agent's `generate_*` / `get_*_task` call as an
 * `acp:generator_call` event, because the engines need a canvas to rasterise
 * into and the model transport for `designLoop` — neither exists in the MCP
 * child process. This module runs the call and answers `generator_reply`.
 *
 * A call must never reject: the host parks the agent's tool call until an
 * answer arrives, so an unhandled failure would hang the turn rather than
 * report a problem.
 */

import { logFrontendError } from '@/lib/log-api'

/** The event carrying one generator call from the host. */
export const GENERATOR_CALL_EVENT = 'acp:generator_call'

/** The `/ws` request that answers it. */
export const GENERATOR_REPLY_REQUEST = 'generator_reply'

/** One generator call as the host forwards it. */
export interface GeneratorCall {
  agentId: string
  sessionId: string
  callId: number
  /** The agent's tool name, e.g. `generate_clothing` or `get_3d_task`. */
  tool: string
  /** The tool arguments as JSON text, unparsed. */
  arguments: string
}

/** The answer the host parks the agent's call for. */
export interface GeneratorReply {
  callId: number
  ok: boolean
  result?: unknown
  error?: string
}

/** Runs one forwarded call. Must not reject; return the failure instead. */
export type GeneratorCallHandler = (call: GeneratorCall) => Promise<GeneratorReply>

/** What the client needs from its transport. */
export interface GeneratorGatewayTransport {
  request(type: typeof GENERATOR_REPLY_REQUEST, payload: unknown): Promise<unknown>
  /** Whether the socket is open and authenticated. */
  isLive(): boolean
}

export class GeneratorGatewayClient {
  private handler: GeneratorCallHandler | null = null

  constructor(private readonly transport: GeneratorGatewayTransport) {}

  /** Install the handler that runs calls. */
  setHandler(handler: GeneratorCallHandler | null): void {
    this.handler = handler
  }

  /** One `acp:generator_call` event, run and answered. */
  async handleCall(call: GeneratorCall): Promise<void> {
    const reply = await this.run(call)
    if (!this.transport.isLive()) {
      void logFrontendError({
        level: 'warn',
        source: 'generator-gateway',
        message: `${call.tool} finished with no live connection; its answer is lost`
      })
      return
    }
    try {
      await this.transport.request(GENERATOR_REPLY_REQUEST, reply)
    } catch (error) {
      void logFrontendError({
        level: 'warn',
        source: 'generator-gateway',
        message: `${call.tool} reply failed: ${String(error)}`
      })
    }
  }

  private async run(call: GeneratorCall): Promise<GeneratorReply> {
    if (!this.handler) {
      return {
        callId: call.callId,
        ok: false,
        error: `no generator is registered for ${call.tool} in this window`
      }
    }
    try {
      return await this.handler(call)
    } catch (error) {
      return {
        callId: call.callId,
        ok: false,
        error: `${call.tool} failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}
