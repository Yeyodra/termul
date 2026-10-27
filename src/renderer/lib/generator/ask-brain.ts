/**
 * The seam between `designLoop` and a real model.
 *
 * Termul has two brain kinds and no shared abstraction above them, so this
 * module takes the transport as a callback rather than importing one. That keeps
 * the loop testable and keeps the ACP dependency out of the engine.
 *
 * The three facts `01-generator-loop/REPORT.md` §4 calls load-bearing:
 *  - generation is a pure text/vision call: `tools: []`
 *  - the engine `action` rides the first turn only
 *  - a non-ACP brain gets its system prompt folded into the first user message,
 *    because ACP has no separate system-prompt slot in the same sense
 */

import type { Brain, BrainRequest, Msg } from './types'

/** What a transport must provide: one turn in, one reply out. */
export interface BrainTransport {
  send(request: {
    /** The session to talk on, e.g. `gen/clothing`. */
    scope: string
    /** Flattened conversation, oldest first. */
    messages: Array<{ role: 'user' | 'assistant'; text: string; image?: string }>
    system: string
  }): Promise<string>
}

/** Whether the brain can accept an image on a turn. */
export type ImageCapability = (brain: Brain) => boolean

export interface AskBrainOptions {
  transport: BrainTransport
  /** Defaults to "only ACP agents take images". */
  takesImages?: ImageCapability
  /** Called before every transport call; tests assert on it. */
  onSend?: (request: { scope: string; messages: Msg[]; system: string }) => void
}

const ACP_AGENTS = new Set(['claude', 'codex', 'kiro'])

/** Default image capability: the ACP agents that advertise vision. */
export function defaultTakesImages(brain: Brain): boolean {
  return ACP_AGENTS.has(brain.id)
}

/** Fold the system prompt into the first user turn for a non-ACP brain. */
export function flattenForBrain(brain: Brain, history: Msg[], system: string): Msg[] {
  if (ACP_AGENTS.has(brain.id)) return history.map((message) => ({ ...message }))

  const [first, ...rest] = history
  if (!first) return [{ role: 'user', text: system }]
  return [
    { ...first, text: `${system}\n\n${first.text}` },
    ...rest.map((message) => ({ ...message }))
  ]
}

/**
 * Build the `askBrain` the loop expects.
 *
 * Every failure propagates untouched: the loop decides what is retryable, and it
 * needs to see the original error shape (`resumable`, `stalled`, `kind`) to make
 * that call.
 */
export function createAskBrain(options: AskBrainOptions) {
  return async (request: BrainRequest): Promise<string> => {
    const scope = request.brain.scope ?? `gen/${request.action ?? 'unknown'}`
    const messages = flattenForBrain(request.brain, request.history, request.system)

    options.onSend?.({ scope, messages, system: request.system })
    request.onPhase?.(`asking ${request.brain.id}`)

    return options.transport.send({
      scope,
      messages: messages.map((message) => ({
        role: message.role,
        text: message.text,
        ...(message.image ? { image: message.image } : {})
      })),
      system: request.system
    })
  }
}

/** Build the `brainTakesImages` the loop expects. */
export function createBrainTakesImages(
  capability: ImageCapability = defaultTakesImages
): (brain: Brain) => Promise<boolean> {
  return async (brain) => capability(brain)
}
