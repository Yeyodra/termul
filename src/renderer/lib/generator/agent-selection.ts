/**
 * Which ACP agent answers a generator turn.
 *
 * A generation needs a live agent, not a config id: the ACP session is created
 * with the runtime `agentId` the host minted at spawn. Picking the Claude
 * config unconditionally would fail on any machine whose chat runs Codex or
 * OpenCode, so the agent is resolved from the chat in play and only falls back
 * to Claude when nothing is known yet.
 */

import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { useAcpStore } from '@/stores/acp-store'

/**
 * The runtime agent id for `sessionId`, else for the selected agent config,
 * else the live Claude agent. `null` when no agent has been spawned yet — the
 * caller must answer with that rather than inventing an id.
 */
export function resolveGeneratorAgentId(sessionId?: string | null): string | null {
  const state = useAcpStore.getState()
  const live = state.configToLiveAgent ?? {}

  const session = sessionId ? state.sessions?.[sessionId] : undefined
  if (session?.agentId) return session.agentId

  const selected = state.selectedAgentConfigId
  if (selected && live[selected]) return live[selected]

  const claude = live[CLAUDE_AGENT_CONFIG_ID]
  if (claude) return claude

  const anyLive = Object.values(live).find((id) => !!id)
  return anyLive ?? null
}
