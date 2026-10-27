import { beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_AGENT_CONFIG_ID } from '@/lib/claude-agent-id'
import { useAcpStore } from '@/stores/acp-store'
import { resolveGeneratorAgent } from '../agent-selection'

function reset(overrides: Record<string, unknown> = {}) {
  useAcpStore.setState({
    sessions: {},
    agents: {},
    configToLiveAgent: {},
    selectedAgentConfigId: null,
    ...overrides
  } as never)
}

describe('resolveGeneratorAgent', () => {
  beforeEach(() => reset())

  it('uses the chat session agent when the call names one', () => {
    reset({
      sessions: { 's-1': { agentId: 'runtime-codex' } },
      configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' }
    })

    expect(resolveGeneratorAgent('s-1')?.id).toBe('runtime-codex')
  })

  it('uses the selected agent config rather than assuming Claude', () => {
    reset({
      selectedAgentConfigId: 'acp-registry:codex-acp',
      configToLiveAgent: {
        'acp-registry:codex-acp': 'runtime-codex',
        [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude'
      }
    })

    expect(resolveGeneratorAgent()?.id).toBe('runtime-codex')
  })

  it('falls back to the live Claude agent when nothing is selected', () => {
    reset({ configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' } })

    expect(resolveGeneratorAgent()?.id).toBe('runtime-claude')
  })

  it('falls back to any live agent when Claude is not the one running', () => {
    reset({ configToLiveAgent: { 'acp-registry:opencode': 'runtime-opencode' } })

    expect(resolveGeneratorAgent()?.id).toBe('runtime-opencode')
  })

  it('answers null instead of inventing an id when no agent has spawned', () => {
    expect(resolveGeneratorAgent()).toBeNull()
    expect(resolveGeneratorAgent('unknown-session')).toBeNull()
  })

  it('ignores a selected config that has no live agent yet', () => {
    reset({ selectedAgentConfigId: 'acp-registry:codex-acp' })

    expect(resolveGeneratorAgent()).toBeNull()
  })

  it('reports image support from the agent capabilities, not from its name', () => {
    reset({
      configToLiveAgent: { [CLAUDE_AGENT_CONFIG_ID]: 'runtime-claude' },
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
      configToLiveAgent: { 'acp-registry:codex-acp': 'runtime-codex' },
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
      configToLiveAgent: { 'acp-registry:opencode': 'runtime-opencode' },
      agents: { 'runtime-opencode': { id: 'runtime-opencode', capabilities: null } }
    })

    expect(resolveGeneratorAgent()?.takesImages).toBe(false)
  })
})
