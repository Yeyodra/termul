/**
 * The seam between `designLoop` and a real model.
 *
 * Termul has two brain kinds and no shared abstraction above them, so this
 * module takes the transport as a callback rather than importing one. That keeps
 * the loop testable and keeps the ACP dependency out of the engine.
 *
 * The three facts `01-generator-loop/REPORT.md` Â§4 calls load-bearing:
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
    brain?: Brain
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

/**
 * Default image capability: an ACP agent's own `promptCapabilities.image`
 * decides, which the caller supplies. Without that answer, assume no â€” a
 * wrong "yes" sends an image the agent rejects, and the loop pays a retry.
 */
export function defaultTakesImages(brain: Brain): boolean {
  return brain.takesImages === true
}

/**
 * Fold the system prompt into the first user turn.
 *
 * ACP has no system-prompt slot a generator can use, so every agent gets the
 * prompt prepended to its first message â€” RobloxKit does the same
 * (`gen3d:647`). Getting this wrong is silent: the model simply never sees the
 * schema it was supposed to author against, and answers with whatever else it
 * can call.
 */
export function flattenForBrain(brain: Brain, history: Msg[], system: string): Msg[] {
  void brain
  const [first, ...rest] = history
  if (!first) return [{ role: 'user', text: system }]
  if (!system.trim()) return history.map((message) => ({ ...message }))
  return [
    { ...first, text: `${system}\n\n---\n\n${first.text}` },
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
      system: request.system,
      brain: request.brain
    })
  }
}

/** Build the `brainTakesImages` the loop expects. */
export function createBrainTakesImages(
  capability: ImageCapability = defaultTakesImages
): (brain: Brain) => Promise<boolean> {
  return async (brain) => capability(brain)
}
