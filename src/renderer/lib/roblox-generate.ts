/**
 * Starting a generation from a feature page.
 *
 * RobloxKit's panel calls its own engine and writes the item itself, which is why
 * a feature page there works with no chat open. Termul cannot copy that: the
 * record is written by the host, because the host owns the project folder and the
 * only checked binary-write path. So this runs the same engine the agent's tool
 * call would run - same `TaskQueue`, same system prompt, same budgets - and then
 * asks the host to write what came out, through `save_artifact`.
 *
 * The result is one artifact with two entry points, not two systems: an agent
 * calling `generate_clothing` and a user typing on the page both end up in
 * `queueGenerateClothing` and both end up in the same record layout.
 */

import { invoke } from '@tauri-apps/api/core'
import type { DesignType } from '@/lib/generator/engines/clothing/schema'
import {
  type GenerateClothingResult,
  queueGenerateClothing,
  readClothingResult
} from '@/lib/generator/tools/generate-clothing'
import { pageGenerator } from '@/lib/generator-gateway'
import { isTauriContext } from '@/lib/tauri-runtime'
import { refreshLoadedProjects } from '@/stores/roblox-records-store'

/** How often the page polls its own task while it runs. */
const POLL_MS = 700

export interface StartOptions {
  projectPath: string
  prompt: string
  type: DesignType
}

export interface SavedArtifact {
  slug: string
  version: number
  path: string
  relative: string
  itemPath: string
}

export type PageGeneration =
  | { status: 'queued'; taskId: string }
  | { status: 'unavailable'; reason: string }

/**
 * Queue a generation and hand back the task id.
 *
 * `unavailable` is a real answer, not an error: no project open, or the gateway
 * has not started yet. The composer shows the reason instead of pretending.
 */
export function startPageGeneration({ prompt, type }: StartOptions): PageGeneration {
  const deps = pageGenerator()
  if (!deps) {
    return { status: 'unavailable', reason: 'the generator engine is not ready yet' }
  }
  const accepted = queueGenerateClothing(deps.clothing, { type, prompt })
  return { status: 'queued', taskId: accepted.taskId }
}

/** The task's current state, in the shape a poll returns. */
export function pollPageGeneration(taskId: string): GenerateClothingResult {
  const deps = pageGenerator()
  if (!deps) {
    return { status: 'failed', taskId, stage: 'Unknown', error: 'the engine stopped' }
  }
  return readClothingResult(deps.queue, taskId)
}

/**
 * Ask the host to write a finished result.
 *
 * Desktop only: on the web client there is no binary write path, and the project
 * folders belong to the host process. The caller falls back to sending the
 * prompt to the agent there.
 */
export async function saveArtifact(
  projectPath: string,
  result: GenerateClothingResult
): Promise<SavedArtifact> {
  if (!isTauriContext()) {
    throw new Error('saving from a page is desktop-only')
  }
  const written = await invoke<SavedArtifact>('save_artifact', {
    projectPath,
    result
  })
  refreshLoadedProjects()
  return written
}

export interface RunOptions extends StartOptions {
  /** Called with every stage the engine reports, for the node pipeline. */
  onStage?: (stage: string, detail: string | null) => void
}

export type RunOutcome =
  | { status: 'done'; saved: SavedArtifact }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' }

/**
 * Queue, poll to completion, then save. One call for the page's Make button.
 *
 * Polling here rather than in the component keeps the loop in one place and lets
 * a component unmount without orphaning the task: the queue owns the work, so the
 * record still lands on disk and the collection still refreshes.
 */
export async function runPageGeneration(options: RunOptions): Promise<RunOutcome> {
  const started = startPageGeneration(options)
  if (started.status === 'unavailable') {
    return { status: 'failed', error: started.reason }
  }

  let lastStage = ''
  for (;;) {
    const poll = pollPageGeneration(started.taskId)
    if (poll.stage && poll.stage !== lastStage) {
      lastStage = poll.stage
      options.onStage?.(poll.stage, null)
    }
    if (poll.status === 'done') {
      try {
        return { status: 'done', saved: await saveArtifact(options.projectPath, poll) }
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
