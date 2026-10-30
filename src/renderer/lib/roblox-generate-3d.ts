/**
 * The 3D page's own Make button, the counterpart of `roblox-generate.ts`.
 *
 * The clothing page could generate from a prompt while the 3D page could not: it
 * only listed what an agent chat had already produced. The engine deps for a
 * model were already served to the page (`pageGenerator().model3d`), so the gap
 * was the wiring between a prompt and a stored record, which is what this module
 * is.
 *
 * It mirrors the clothing path deliberately, down to the poll loop and the host
 * command: one queue, one write, so the two entry points cannot disagree about
 * how a record is laid out. The differences are only what a model actually has -
 * a GLB instead of a PNG atlas, and a category instead of a garment type.
 */

import { invoke } from '@tauri-apps/api/core'
import { ensureAgentForGeneration } from '@/lib/generator/ensure-agent'
import {
  type Generate3DResult,
  queueGenerate3D,
  readModelResult
} from '@/lib/generator/tools/generate-3d'
import { pageGenerator } from '@/lib/generator-gateway'
import { isTauriContext } from '@/lib/tauri-runtime'
import { refreshLoadedProjects } from '@/stores/roblox-records-store'
import type { SavedArtifact } from './roblox-generate'

/** How often a queued model is polled. The clothing path uses the same figure. */
const POLL_MS = 250

/** The categories the picker offers, in the order a user is likely to want them. */
export const MODEL_CATEGORIES = [
  { id: 'prop', label: 'Prop' },
  { id: 'building', label: 'Building' },
  { id: 'tool', label: 'Tool' },
  { id: 'character', label: 'Character' }
] as const

export type ModelCategory = (typeof MODEL_CATEGORIES)[number]['id']

export interface ModelRunOptions {
  projectPath: string
  prompt: string
  category: ModelCategory
  /** The record this generation revises, when it revises one. */
  recordSlug?: string
  /**
   * The spec being revised.
   *
   * Without it a revision is only an instruction: the engine has nothing to keep
   * "everything else" of, so it re-invents the model from the prompt and the
   * result drifts. The stored spec is the base, exactly as RobloxKit passes it.
   */
  base?: unknown
  onStage?: (stage: string, detail: string | null) => void
}

export type ModelRunOutcome =
  | { status: 'done'; saved: SavedArtifact }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' }

/**
 * Ask the host to write a finished model.
 *
 * The same `save_artifact` command the clothing path uses. The host picks the
 * file extension from the result's own media type (`data:model/gltf-binary`),
 * so a model lands as `v<n>.glb` without the caller saying so.
 */
export async function saveModelArtifact(
  projectPath: string,
  result: Generate3DResult
): Promise<SavedArtifact> {
  if (!isTauriContext()) {
    throw new Error('saving from a page is desktop-only')
  }
  try {
    const written = await invoke<SavedArtifact>('save_artifact', { projectPath, result })
    refreshLoadedProjects()
    return written
  } catch (cause) {
    const detail =
      typeof cause === 'string'
        ? cause
        : cause instanceof Error
          ? cause.message
          : JSON.stringify(cause)
    throw new Error(`the model was built but not saved: ${detail}`)
  }
}

/**
 * Queue a model, poll to completion, then save it.
 *
 * A model generation is a model call, so it needs a live agent; a cold window has
 * none, and waiting never produces one. `ensureAgentForGeneration` reuses a live
 * agent when there is one, so pressing Make does not bill a second process.
 */
export async function runModelGeneration(options: ModelRunOptions): Promise<ModelRunOutcome> {
  const agent = await ensureAgentForGeneration(options.projectPath)
  if (agent.status === 'none') {
    return { status: 'failed', error: agent.reason }
  }

  const deps = pageGenerator()
  if (!deps) {
    return { status: 'failed', error: 'the generator engine is not ready yet' }
  }

  const queued = queueGenerate3D(deps.model3d, {
    prompt: options.prompt,
    category: options.category,
    recordSlug: options.recordSlug,
    spec: options.base
  })

  let lastStage = ''
  for (;;) {
    const poll = readModelResult(deps.queue, queued.taskId)
    if (poll.stage && poll.stage !== lastStage) {
      lastStage = poll.stage
      options.onStage?.(poll.stage, null)
    }
    if (poll.status === 'done') {
      try {
        return { status: 'done', saved: await saveModelArtifact(options.projectPath, poll) }
      } catch (cause) {
        return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) }
      }
    }
    if (poll.status === 'failed') {
      return { status: 'failed', error: poll.error ?? 'the generation failed' }
    }
    if (poll.status === 'cancelled' || poll.status === 'interrupted') {
      return { status: 'cancelled' }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/**
 * What `Revise` asks for.
 *
 * Named on purpose, exactly like `revisionPrompt` for a garment: the host files a
 * record by the name the engine returns, so asking for the same name is what
 * makes this land as a new version of the same model instead of a second model
 * beside it.
 */
export function modelRevisionPrompt(recordSlug: string, version: number, change: string): string {
  return `Revise the existing 3D model "${recordSlug}" (v${version}). Change: ${change.trim()}. Keep everything else the same and keep the same name, so this lands as a new version of the same item.`
}
