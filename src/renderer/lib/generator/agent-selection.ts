/**
 * Which ACP agent answers a generator turn, and what it can do.
 *
 * A generation needs a live agent, not a config id: the ACP session is created
 * with the runtime `agentId` the host minted at spawn. Picking Claude
 * unconditionally would send a Codex chat's generation to an agent that is not
 * in play, so the agent is resolved from the chat and only falls back to
 * Claude when nothing is known yet.
 */

import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { useAcpStore } from '@/stores/acp-store'

/** A resolved agent and the capabilities it advertised at `initialize`. */
export interface GeneratorAgent {
  id: string
  /** `promptCapabilities.image`: whether this agent accepts pictures at all. */
  takesImages: boolean
}

function takesImagesOf(capabilities: unknown): boolean {
  const prompt = (capabilities as { promptCapabilities?: { image?: boolean } | null })
    ?.promptCapabilities
  return prompt?.image === true
}

/**
 * The runtime agent id for `sessionId`, else for the selected agent config,
 * else the live Claude agent, else any live agent.
 *
 * `null` when no agent has been spawned yet — the caller reports that rather
 * than inventing an id, because a wrong id fails as "unknown agent".
 */
export function resolveGeneratorAgent(sessionId?: string | null): GeneratorAgent | null {
  const state = useAcpStore.getState()
  const live = state.configToLiveAgent ?? {}
  const agents = state.agents ?? {}

  const pick = (id: string | undefined | null): GeneratorAgent | null => {
    if (!id) return null
    return { id, takesImages: takesImagesOf(agents[id]?.capabilities) }
  }

  const session = sessionId ? state.sessions?.[sessionId] : undefined
  const fromSession = pick(session?.agentId)
  if (fromSession) return fromSession

  const selected = state.selectedAgentConfigId
  if (selected) {
    const fromSelection = pick(live[selected])
    if (fromSelection) return fromSelection
  }

  const fromClaude = pick(live[CLAUDE_AGENT_CONFIG_ID])
  if (fromClaude) return fromClaude

  return pick(Object.values(live).find((id) => !!id))
}
