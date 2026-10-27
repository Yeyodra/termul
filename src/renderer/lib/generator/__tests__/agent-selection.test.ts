import { beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { agentReuseKey } from '@/stores/acp-reuse-keys'
import { useAcpStore } from '@/stores/acp-store'
import { liveForConfig, resolveGeneratorAgent } from '../agent-selection'

const CWD = 'C:\\Users\\Novella\\Documents\\robloxkit'
const CODEX = 'acp-registry:codex-acp'
const OPENCODE = 'acp-registry:opencode'

function reset(overrides: Record<string, unknown> = {}) {
  useAcpStore.setState({
    sessions: {},
    agents: {},
    configToLiveAgent: {},
    selectedAgentConfigId: null,
    ...overrides
  } as never)
}

/** A live map keyed the way production keys it: `configId\0cwd`. */
function live(...entries: Array<[string, string, string?]>): Record<string, string> {
  return Object.fromEntries(
    entries.map(([configId, agentId, cwd]) => [agentReuseKey(configId, cwd ?? CWD), agentId])
  )
}

describe('liveForConfig', () => {
  it('finds a live agent through the reuse-key format, not a bare config id', () => {
    const map = live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude'])
    expect(liveForConfig(map, CLAUDE_AGENT_CONFIG_ID)).toBe('runtime-claude')
  })

  it('prefers the agent bound to the requested working directory', () => {
    const map = {
      ...live([CLAUDE_AGENT_CONFIG_ID, 'other-cwd', '/elsewhere']),
      ...live([CLAUDE_AGENT_CONFIG_ID, 'this-cwd', CWD])
    }

    expect(liveForConfig(map, CLAUDE_AGENT_CONFIG_ID, CWD)).toBe('this-cwd')
    expect(liveForConfig(map, CLAUDE_AGENT_CONFIG_ID, '/elsewhere')).toBe('other-cwd')
  })

  it('accepts a detached key as a last resort', () => {
    const detached = `${agentReuseKey(CLAUDE_AGENT_CONFIG_ID, CWD)}\0runtime-detached`
    expect(liveForConfig({ [detached]: 'runtime-detached' }, CLAUDE_AGENT_CONFIG_ID)).toBe(
      'runtime-detached'
    )
  })

  it('answers null for a config that is not live', () => {
    expect(liveForConfig(live([OPENCODE, 'runtime-opencode']), CLAUDE_AGENT_CONFIG_ID)).toBeNull()
  })
})

describe('resolveGeneratorAgent', () => {
  beforeEach(() => reset())

  it('prefers the agent executing the tool call over everything else', () => {
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      selectedAgentConfigId: CLAUDE_AGENT_CONFIG_ID,
      configToLiveAgent: {
        ...live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude']),
        ...live([CODEX, 'runtime-codex'])
      }
    })

    expect(resolveGeneratorAgent({ agentId: 'runtime-claude' })?.id).toBe('runtime-claude')
  })

  it('uses the chat session agent when the call does not name one', () => {
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      configToLiveAgent: live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude'])
    })

    expect(resolveGeneratorAgent({ sessionId: 's-1' })?.id).toBe('runtime-codex')
  })

  it('uses the selected harness, resolved through the reuse key', () => {
    reset({
      selectedAgentConfigId: CODEX,
      configToLiveAgent: {
        ...live([CODEX, 'runtime-codex']),
        ...live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude'])
      }
    })

    expect(resolveGeneratorAgent({ cwd: CWD })?.id).toBe('runtime-codex')
  })

  // The reported bug: Claude Code selected, OpenCode live, generation ran on
  // OpenCode because the lookup used a bare config id and then fell through to
  // "any live agent".
  it('never substitutes a different harness for the selected one', () => {
    reset({
      selectedAgentConfigId: CLAUDE_AGENT_CONFIG_ID,
      configToLiveAgent: live([OPENCODE, 'runtime-opencode'])
    })

    expect(resolveGeneratorAgent({ cwd: CWD })).toBeNull()
  })

  it('does not fall back to an arbitrary live agent when nothing is selected', () => {
    reset({ configToLiveAgent: live([OPENCODE, 'runtime-opencode']) })
    expect(resolveGeneratorAgent({ cwd: CWD })).toBeNull()
  })

  it('falls back to the live Claude agent when nothing is selected', () => {
    reset({ configToLiveAgent: live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude']) })
    expect(resolveGeneratorAgent({ cwd: CWD })?.id).toBe('runtime-claude')
  })

  it('answers null instead of inventing an id when no agent has spawned', () => {
    expect(resolveGeneratorAgent()).toBeNull()
    expect(resolveGeneratorAgent({ sessionId: 'unknown-session' })).toBeNull()
  })

  it('ignores a selected config that has no live agent yet', () => {
    reset({ selectedAgentConfigId: CODEX })
    expect(resolveGeneratorAgent()).toBeNull()
  })

  it('reports image support from the agent capabilities, not from its name', () => {
    reset({
      configToLiveAgent: live([CLAUDE_AGENT_CONFIG_ID, 'runtime-claude']),
      agents: {
        'runtime-claude': {
          id: 'runtime-claude',
          capabilities: { promptCapabilities: { image: true } }
        }
      }
    })

    expect(resolveGeneratorAgent()?.takesImages).toBe(true)
  })

  it('reports no image support when the agent does not advertise it', () => {
    reset({
      selectedAgentConfigId: CODEX,
      configToLiveAgent: live([CODEX, 'runtime-codex']),
      agents: {
        'runtime-codex': {
          id: 'runtime-codex',
          capabilities: { promptCapabilities: { image: false } }
        }
      }
    })

    expect(resolveGeneratorAgent()?.takesImages).toBe(false)
  })

  it('reports no image support when the capabilities are unknown', () => {
    reset({
      selectedAgentConfigId: OPENCODE,
      configToLiveAgent: live([OPENCODE, 'runtime-opencode']),
      agents: { 'runtime-opencode': { id: 'runtime-opencode', capabilities: null } }
    })

    expect(resolveGeneratorAgent()?.takesImages).toBe(false)
  })
})
