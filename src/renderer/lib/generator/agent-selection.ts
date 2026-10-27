/**
 * Which ACP agent answers a generator turn, and what it can do.
 *
 * A generation needs a live agent, not a config id: the ACP session is created
 * with the runtime `agentId` the host minted at spawn.
 *
 * The resolution order is deliberate, and the reason it is written down is that
 * getting it wrong is silent — the turn simply runs on the wrong harness and
 * bills the wrong subscription:
 *
 *  1. the agent that is executing the tool call (`call.agentId`) — authoritative,
 *     because it is literally the process that asked
 *  2. the agent of the calling chat (`sessions[sessionId].agentId`)
 *  3. the agent the user selected, resolved through the reuse-key format
 *  4. the live Claude agent, same way
 *  5. nothing — the caller reports it
 *
 * `configToLiveAgent` is keyed by `agentReuseKey(configId, cwd, projectId)`, i.e.
 * `configId\0cwd`, so a bare `live[configId]` lookup can never match. That was a
 * real defect: steps 3 and 4 always missed and resolution fell through to "any
 * live agent", which is how a Claude Code chat ended up generating on OpenCode.
 */

import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { configIdFromReuseKey, parseReuseKey } from '@/stores/acp-reuse-keys'
import { useAcpStore } from '@/stores/acp-store'

/** A resolved agent and the capabilities it advertised at `initialize`. */
export interface GeneratorAgent {
  id: string
  /** `promptCapabilities.image`: whether this agent accepts pictures at all. */
  takesImages: boolean
}

/** What the caller knows about the turn, so resolution can be exact. */
export interface GeneratorAgentHint {
  /** The agent executing the tool call; authoritative when present. */
  agentId?: string | null
  /** The chat that asked, if any. */
  sessionId?: string | null
  /** The active project, to prefer the agent spawned for it. */
  cwd?: string | null
}

function takesImagesOf(capabilities: unknown): boolean {
  const prompt = (capabilities as { promptCapabilities?: { image?: boolean } | null })
    ?.promptCapabilities
  return prompt?.image === true
}

/**
 * The live agent spawned for `configId`, preferring one bound to `cwd`.
 *
 * Scans the reuse keys because they carry the cwd; a literal lookup cannot work
 * against this map. A detached key (`…\0<agentId>`) still names a real live
 * process, so it is a valid answer when nothing canonical matches.
 */
export function liveForConfig(
  live: Record<string, string>,
  configId: string,
  cwd?: string | null
): string | null {
  const wanted = cwd?.trim()
  let fallback: string | null = null

  for (const [key, agentId] of Object.entries(live)) {
    if (!agentId) continue
    if (configIdFromReuseKey(key) !== configId) continue

    if (wanted && parseReuseKey(key).cwd === wanted) return agentId
    fallback ??= agentId
  }

  return fallback
}

/**
 * The runtime agent id for this turn, or `null` when none can be justified.
 *
 * `null` is a real answer: the transport reports it rather than inventing an id,
 * because a wrong id fails as "unknown agent" and a wrong *harness* fails
 * silently.
 */
export function resolveGeneratorAgent(hint: GeneratorAgentHint = {}): GeneratorAgent | null {
  const state = useAcpStore.getState()
  const live = state.configToLiveAgent ?? {}
  const agents = state.agents ?? {}

  const pick = (id: string | undefined | null): GeneratorAgent | null => {
    if (!id) return null
    return { id, takesImages: takesImagesOf(agents[id]?.capabilities) }
  }

  const fromCall = pick(hint.agentId)
  if (fromCall) return fromCall

  const session = hint.sessionId ? state.sessions?.[hint.sessionId] : undefined
  const fromSession = pick(session?.agentId)
  if (fromSession) return fromSession

  const selected = state.selectedAgentConfigId
  if (selected) {
    const fromSelection = pick(liveForConfig(live, selected, hint.cwd))
    if (fromSelection) return fromSelection
  }

  return pick(liveForConfig(live, CLAUDE_AGENT_CONFIG_ID, hint.cwd))
}
