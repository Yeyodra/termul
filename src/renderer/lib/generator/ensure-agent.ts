/**
 * Making sure a generation has an agent to ask.
 *
 * A generation is a model call, so the engine needs a live ACP agent. An agent
 * is spawned when a chat starts, which meant a feature page only worked if the
 * user had opened a chat first - pressing Make it on a cold window failed with
 * "no ACP agent is running". Waiting would not have helped: nothing was going to
 * spawn one.
 *
 * So the page spawns one itself, using the agent the user picked, exactly as a
 * chat would. It reuses a live agent when one already exists for this project,
 * because spawning a second process for the same config would bill a second
 * subscription and is what `resolveGeneratorAgent` exists to avoid.
 */

import type { StoredAgentConfig } from '@/lib/acp-agents-persistence'
import type { AgentConfig } from '@/lib/acp-api'
import { resolveGeneratorAgent } from '@/lib/generator/agent-selection'
import { useAcpStore } from '@/stores/acp-store'
import { useProjectStore } from '@/stores/project-store'

export type EnsureAgentResult =
  | { status: 'ready'; agentId: string }
  | { status: 'none'; reason: string }

/**
 * The agent to spawn: the one the user picked, else the first configured.
 *
 * There is no fallback to "any agent" on purpose. A generation runs on the
 * harness the user chose, and silently picking another one bills the wrong
 * subscription - the exact defect `agent-selection.ts` documents.
 */
function configToSpawn(configs: StoredAgentConfig[]): StoredAgentConfig | null {
  const state = useAcpStore.getState()
  const selected = state.selectedAgentConfigId
  if (selected) {
    // `selectedAgentConfigId` holds a configId, not the stored `id`. Matching only
    // `id` missed every catalog config (whose local id is a uuid), fell through to
    // `configs[0]`, and spawned a harness the user had not picked - and the
    // generator then could not resolve that spawn back, so the turn failed with
    // "no ACP agent is running" even though a process had just started.
    const match =
      configs.find((config) => config.configId === selected) ??
      configs.find((config) => config.id === selected)
    if (match) return match
  }
  return configs[0] ?? null
}

/**
 * The launch fields the host accepts, and nothing else.
 *
 * A stored config carries a local `id` for durable session matching. The host's
 * `AgentConfig` is `deny_unknown_fields`, so sending the stored object whole is
 * rejected with "unknown field `id`" and the agent never starts - which read as
 * "could not start Claude Agent" on every generation. `ensureLiveAgent` already
 * builds this projection by hand; this is the same list, in one place.
 */
function spawnFields(config: StoredAgentConfig): AgentConfig {
  return {
    // The reuse map is keyed by configId, so a spawn that leaves it empty can
    // never be found again: the process starts, the map records nothing usable,
    // and the next resolution reports "no ACP agent is running". Falling back to
    // the local id keeps a spawn addressable for a config that never had one.
    configId: config.configId ?? config.id,
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
    allowTerminal: config.allowTerminal
  }
}

/**
 * A live agent for this project, spawning one when none exists.
 *
 * `cwd` is what makes a spawn reusable: the reuse key carries it, so a second
 * call for the same project finds the agent the first call started.
 */
export async function ensureAgentForGeneration(cwd: string): Promise<EnsureAgentResult> {
  const live = resolveGeneratorAgent({ cwd })
  if (live) return { status: 'ready', agentId: live.id }

  const state = useAcpStore.getState()
  const configs = state.agentConfigs ?? []
  const config = configToSpawn(configs)
  if (!config) {
    return {
      status: 'none',
      reason: 'No agent is configured yet. Add one in Settings, then try again.'
    }
  }

  try {
    const projectId = useProjectStore.getState().activeProjectId
    const agentId = await state.spawnAgent(spawnFields(config), projectId)
    return { status: 'ready', agentId }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return { status: 'none', reason: `Could not start ${config.name}: ${detail}` }
  }
}
