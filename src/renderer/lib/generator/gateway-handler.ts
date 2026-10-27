/**
 * Runs the generator tools the host forwards, using the clothing engine that
 * is ported today.
 *
 * Only `clothing` has an engine, so every other family answers with a clear
 * refusal instead of a broken promise: the tool list advertises them because
 * the guide names them, but a call must say what is missing rather than
 * silently returning an empty artifact.
 */

import type { GeneratorCall, GeneratorReply } from '@/lib/acp-transport/generator-gateway-client'
import type { TaskQueue } from '@/lib/generator/task-queue'
import {
  type ClothingToolDeps,
  type GenerateClothingResult,
  queueGenerateClothing,
  readClothingResult
} from '@/lib/generator/tools/generate-clothing'
import { useArtifactStore } from '@/stores/artifact-store'

/**
 * Hand a finished garment to the viewport.
 *
 * Published from the poll, not from the generation: the artifact is only ready
 * when the engine says so, and a chat that never polls never showed it.
 */
function publishClothingArtifact(result: GenerateClothingResult): void {
  if (!result.atlas || !result.kind) return
  useArtifactStore.getState().publish(
    {
      kind: 'clothing',
      type: result.kind,
      atlas: result.atlas,
      name: result.name
    },
    result.image
  )
}

/** Which engine each tool family needs, for the refusal message. */
const UNAVAILABLE = new Set([
  'generate_3d',
  'get_3d_task',
  'generate_sfx',
  'get_sfx_task',
  'generate_texture',
  'get_texture_task',
  'generate_skybox',
  'get_skybox_task',
  'generate_icon',
  'get_icon_task',
  'generate_vfx',
  'get_vfx_task',
  'generate_gfx',
  'get_gfx_task',
  'generate_animation',
  'get_animation_task',
  'generate_cutscene',
  'get_cutscene_task'
])

export interface GeneratorHandlerDeps {
  queue: TaskQueue
  clothing: ClothingToolDeps
}

function parseArguments(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * The handler the gateway installs. It resolves the tool name to an engine,
 * runs it, and always answers — a throw here would park the agent's call
 * until the host timeout.
 */
export function createGeneratorHandler(deps: GeneratorHandlerDeps) {
  return async (call: GeneratorCall): Promise<GeneratorReply> => {
    try {
      return await dispatch(deps, call)
    } catch (error) {
      return {
        callId: call.callId,
        ok: false,
        error: `${call.tool} failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
}

async function dispatch(deps: GeneratorHandlerDeps, call: GeneratorCall): Promise<GeneratorReply> {
  if (UNAVAILABLE.has(call.tool)) {
    return {
      callId: call.callId,
      ok: false,
      error:
        `${call.tool} has no engine in this build yet. Only the clothing generator is ` +
        'implemented; the others are listed so the tool names are stable. Tell the user ' +
        'this engine is not available rather than approximating it another way.'
    }
  }

  if (call.tool === 'generate_clothing') {
    const args = parseArguments(call.arguments)
    // The garment type is read from the tool call, because the engine's
    // validator takes it as an argument rather than from the spec. A spec that
    // carries its own `type` is accepted too, so an agent that put it inside
    // `spec` is not punished for a reasonable guess.
    const spec = args.spec as Record<string, unknown> | undefined
    const type = args.type ?? spec?.type
    if (type !== 'shirt' && type !== 'pants' && type !== 'tshirt') {
      return {
        callId: call.callId,
        ok: false,
        error:
          'generate_clothing needs `type` as a top-level argument: one of "shirt", "pants" ' +
          'or "tshirt". It is not read from inside `spec`.'
      }
    }
    const accepted = queueGenerateClothing(deps.clothing, {
      type,
      prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
      design: spec,
      agentId: call.agentId,
      sessionId: call.sessionId
    })
    return { callId: call.callId, ok: true, result: accepted }
  }

  if (call.tool === 'get_clothing_task') {
    const args = parseArguments(call.arguments)
    const taskId = args.task_id
    if (typeof taskId !== 'string' || !taskId) {
      return {
        callId: call.callId,
        ok: false,
        error: 'get_clothing_task needs a task_id string'
      }
    }
    const result = readClothingResult(deps.queue, taskId)
    if (result.status === 'done') publishClothingArtifact(result)
    return {
      callId: call.callId,
      ok: true,
      result
    }
  }
  return {
    callId: call.callId,
    ok: false,
    error: `${call.tool} is not a generator tool this window serves`
  }
}
